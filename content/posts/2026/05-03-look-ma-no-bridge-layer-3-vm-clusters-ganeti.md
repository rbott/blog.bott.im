---
title: "Look Ma, no Bridge: Layer 3 VM Clusters with Ganeti"
description: ""
date: 2026-05-03
tags:
  - ganeti
  - routing
  - linux
  - bird
  - bgp
  - unnumbered
---

Earlier last year I [wrote a piece about BGP unnumbered](https://blog.bott.im/bgp-unnumbered-in-2025-same-idea-different-implementations/) layer-3-only datacenter networks. Meanwhile that has been put into production and while it works great for regular hosts, we now want to explore how to use it with virtual machines. Specifically with VMs running on Ganeti clusters.

My employer has been using Ganeti since 2014 and I became one of the maintainers of the Ganeti project when Google stopped working on it and handed the project over to the community in 2020. If you are not familiar with Ganeti terminology: a "node" refers to a physical server, running virtual machines. A virtual machine is called an "instance". We use KVM for virtualization, DRBD as storage layer and our current Ganeti clusters use layer 2 bridged connectivity which obviously does not work well in the new layer-2-less world. Let's give a brief summary of how the network is designed:

- Spine / Leaf / Host architecture
- BGP unnumbered with IPv6 link-local addressing between all architecture layers
- IPv4 connectivity through IPv4-over-IPv6-nexthop ([RFC 8950](https://datatracker.ietf.org/doc/rfc8950/))
- [Bird](https://bird.network.cz/) on the host
- Public host IP addresses (IPv4 & IPv6) are configured as loopback IPs on Linux `dummy` interfaces
- Bird also provides a local BGP listener so that other services can interact with it (e.g. k8s CNIs) and can be extended through a `conf.d`-style folder (e.g. for VM-Host- or anycast service setups).

We started with the following goals and non-goals for the new VM infrastructure:

- Bird running on a Ganeti node must somehow announce the IP addresses of the running instances to the connected leaf switches.
- Live migration must be supported, but the subsecond failover times of our current layer-2-based clusters are not required. Network downtimes of several seconds are acceptable for the intended workloads.
- Clusters stretched across datacenters must be possible (sort of a given, when there's layer 3 connectivity everywhere :-) ).
- BGP connectivity *inside* instances is required for *some* workloads (e.g. k8s CNIs, anycast services).
- We do not need a migration path for existing Ganeti instances from layer-2-based clusters. If a *service* needs to be migrated, it will be deployed into a fresh instance.

# Ganeti: Network Basics

Before we jump straight into our setup, let's do a quick room-tour of Ganeti's network modes. You can set the network mode on each instance network interface with the `mode` parameter (`bridged`, `ovs` or `routed`). Again for clarity: the network mode is *not* set on instance level, but on NIC level. You may mix-and-match multiple modes on a single instance with multiple NICs.

## Bridged - The Traditional One

Ganeti supports standard Linux bridges, both vlan-aware and non-vlan-aware bridges. From a system point of view there is not more to prepare than to create the bridge(s), add an external interface to it and you are done. Ganeti will take care of the rest. If you use vlans, you have two options:

- Use standard bridges and create one bridge per vlan (and add a tagged upstream interface like `bond0.150` or `eth0.150` to it). Assign an instance NIC to a specific vlan by assigning the corresponding bridge device (e.g. `link=br150`).
- Use a single vlan-aware bridge and let Qemu take care of (un)tagging traffic by configuring the instance NIC parameter `vlan=.150`. This greatly simplifies/unclutters the network configuration on your Ganeti nodes.

Bridged networking is probably the most common setup out there, mostly due to its simplicity and ease of use.

## Open vSwitch - The Bridge On Steroids

[OVS](https://www.openvswitch.org/) shines where standard bridges run out of steam. If you run an overlay network (e.g. VXLAN or GRE-based), need flow-based traffic forwarding rules or complex ACLs Open vSwitch enters the game. As with standard bridges, you are responsible to provide the OVS setup by yourself. Ganeti will take care of adding/removing instance interfaces (along with vlan configuration) but will not manage any other aspects of OVS.

Personally I have never used OVS myself so I can not provide any first-hand experiences.

## Routed - But Not In The Way You Might Think

There has been a "routed" network mode in Ganeti for a long time. But in the context of *this* blog post it probably does not do what you might expect. "Routed" actually only refers to the way the traffic flows between the node and the instance. Outside connectivity is still assumed to be layer 2. Each `routed` instance NIC requires its `ip` parameter to be filled with an IPv4 or IPv6 address. Upon instance start, the following happens on the node:

- a TAP interface is created to represent the node side of the instance NIC
- a route to $IP is installed on the node, pointing at the TAP interface
- enables Proxy ARP on the TAP interface

You also need to enable Proxy ARP on your public node interface as well. Inside the instance you configure `$IP` on your virtual network device and add a default route which points to that device (e.g. `ip route add default dev eth0`).

So how does traffic actually flow? Let's start with the inbound direction: when a neighboring layer 2 device emits an ARP request for your instance's IP address, the Ganeti node will reply on behalf of your instance (thanks to Proxy ARP on the public interface), receive the following IP packet and forward it - following its local route - to the instance's TAP interface. Tada, you now have a working mix-and-match combination of layer 2 and layer 3 for your instance connectivity.

The outbound direction is where the other Proxy ARP setting comes in. Because the instance has a default route using `dev eth0` (without a gateway IP), it will emit an ARP request for any destination IP it wants to talk to. With Proxy ARP enabled on the TAP interface, the host responds to each of these requests with the MAC of the TAP interface, causing the instance to send all traffic to the host, which then proceeds with standard routing from there.

There are two operational gotchas worth knowing about: every unsolicited inbound probe from the public internet - and there's a lot of that - causes the instance to issue an ARP request for the source IP, which in turn creates a neighbor table entry on the instance. The instance's ARP table size therefore scales with internet background noise rather than with anything meaningful. It is not an essential problem, but noisy and potentially confusing when debugging network issues.

The second gotcha affects live migration: when live-migrating a `routed` instance over to another node, a fresh TAP interface with a *different* (auto-assigned) MAC address will be created on the new node. However, all of the IPs sitting in the instance's ARP cache will still point to the *old* MAC address and communication with these IP addresses will be dead until the garbage collection process of the Kernel kicks in (which also means: the old entries will not necessarily expire at the same time). If both `routed` mode and live migration are important to you, you can mitigate this issue by using the hack mentioned in the next chapter and always assign each and every TAP interface across all nodes the very same MAC address (yes, that works entirely fine and does not cause any trouble).

## How To Hack Ganeti Networking

Up until Ganeti version 3.1 there is a somewhat strange looking shell code snippet in the `kvm-ifup` script:

```shell
if [ -x "$CONF_DIR/kvm-vif-bridge" ]; then
  exec $CONF_DIR/kvm-vif-bridge
fi
```

In most cases, `$CONF_DIR` equals `/etc/ganeti` - so if the executable file `/etc/ganeti/kvm-vif-bridge` exists, it will be executed *instead* of the current shell script. Since this happens ahead of the function calls which *would* configure routed/ovs/bridged networking, you can essentially replace all of Ganeti's configuration logic with your own. However, some limitations apply:

- Ganeti still assumes the network mode you have set on the NIC level and will validate/enforce their relevant parameters (e.g. `routed` requires `ip` to be given and you can not have two NICs with the same `ip` value for obvious reasons)
- During instance live migration, `bridged` and `ovs` NICs will be configured *ahead* of the migration while `routed` NICs will be configured *after* migration has finished

I am not sure why this `kvm-vif-bridge` solution exists and I consider it mostly a hack due to the above limitations (and the script's rather odd name). But as this is what the current stable version of Ganeti provides, we went with it.

## A Look Into The Future: Down-Scripts, Modding And Ext Mode

While the above solution did get us very far, it did not feel right. So I set out to renovate the Ganeti network configuration subsystem and came up with this (merged) pull request: [PR #1919: Redesign KVM ifup logic and add optional ifdown scripts](https://github.com/ganeti/ganeti/pull/1919). It addresses the following issues/shortcomings/feature requests:

- All network modes now feature a "down" script (although they are not used for `routed`, `bridged` and `ovs` for now). That implemented an older pending [design doc](https://github.com/ganeti/ganeti/blob/master/doc/design-ifdown.rst).
- All network modes allow for customization: they check the existence of `/etc/ganeti/network/$mode/$action` (where `$action` would be `up` or `down`) and branch out to that if present.
- There is a new network mode `ext` which is specifically meant to implement a custom network type. You can use all available NIC parameters (`link`, `vlan`, `ip`, `network` etc.) but Ganeti will not enforce/validate any inputs. You can place your scripts/executables in `/etc/ganeti/network/ext/` and you can also decide whether you want to configure the network ahead or after an instance live migration.
- It added [extensive documentation](https://github.com/ganeti/ganeti/blob/master/doc/network.rst) for all network modes (linked is the sourcecode version for now as no official version of Ganeti 3.2 has been released yet).

While this will not be backported to the `stable-3.1` branch, it will be part of the upcoming Ganeti 3.2 release. If **you** think you can benefit from the new network mode and spot bugs or missing features, please do not hesitate to open an [issue](https://github.com/ganeti/ganeti/issues) or start a discussion on the [mailing list](https://ganeti.org/community.html).

# Ganeti Setup

A quick word on Ganeti itself in layer-3-only environments: the setup was no different from regular installations. As stated earlier, each host has its public /32 loopback IP address configured on a `dummy0` interface. We assigned an extra /32 loopback address as the cluster master IP and configured `dummy0` as the master network device. Ganeti will configure the extra /32 IP address on the master node, `bird` will pick up the extra address and announce it to the leaf switches. Things like DRBD storage replication also worked right out of the box. Ganeti does not make any assumptions about the network which might break in such a layer-3-only environment.

# The Easy Way: Non-BGP-Aware Instances

We tried to follow the KISS principle: just use what's there. We set our example instance's NIC to `routed`, stored its loopback IP address in the `ip` parameter and modified our `bird` configuration to pick up all static /32 routes from the kernel routing table and export them via BGP to the leaf switches. We configured the loopback IP address on the `eth0` interface inside the instance, configured a default route via `dev eth0` et voilà: we have IP connectivity from our instance.

Pros:
- No BGP/bird inside the VM required (less moving parts)
- Live migration works with a downtime of ~10 seconds, but only if the above mentioned workaround with the static TAP MAC address is used

Cons:
- We are limited by Ganeti's data model: only one IP address per virtual NIC
- Changing the IP address of an instance requires work in Ganeti (update instance configuration and reboot instance) *and* re-configure network inside the instance
- Public systems end up with *a lot* of MAC addresses in the ARP cache

While it worked, especially the inflexible IP configuration made us dismiss this solution. All of our servers ("classic" physical or virtual servers but also the newer layer-3-only physical servers) are "in charge" of their network configuration. They can change their IP address without external dependencies (especially without a reboot). While changing a server's IP address is not exactly a regular maintenance task, adding secondary IPs or running dual stack configurations is more common. Neither would be possible with this setup. For the record: Ganeti's `ip` NIC parameter *does* support IPv6, but only one IP address at a time and you would then end up with a dedicated IPv4 NIC and another dedicated IPv6 NIC inside your instances.


# The Interesting Way: BGP-Aware Instances

To cover all of our planned usecases, we need to provide downstream BGP connectivity to our instances. We also went with the assumption that it would greatly simplify things for users of our systems, if both virtual and physical servers provide the same "interface". That includes:

- one or more loopback IP addresses on a `dummy0` interface
- local instance of bird with a BGP listener
- IPv4 and IPv6 connectivity while the former uses IPv4-over-IPv6 next-hop

The main difference would be: physical servers have two uplinks, while a virtual server only has one - but that is mostly irrelevant to users of these systems.

## Node <-> Instance Communication

First off, we need to establish how nodes and instances communicate. To keep it simple, we will use static IPv6 link-local addresses and have Ganeti always assign `fe80::1` on the TAP interface while the instance always configures `fe80::2` on its virtual interface `eth0`. To verify this works, we can use `ping fe80::1%eth0` inside our instance or `ping fe80::2%tapX` on our node, where `tapX` is the TAP interface that corresponds to our test instance.

Additionally, we instruct the bird instance on the node to set up a BGP session on the freshly created TAP interface and also use the above mentioned workaround with a "static" MAC address for each tap interface. The custom Ganeti network script `/etc/ganeti/kvm-vif-bridge` looks somewhat like this:

```shell
#!/bin/bash

# use a fixed MAC address to reduce ARP cache issues during live migration
ip link set "${INTERFACE}" address "5e:aa:bb:cc:dd:e0"
ip link set "${INTERFACE}" up

# configure static link-local address
ip a add "fe80::1/64" dev "${INTERFACE}"

# configure bird to attach a BGP session to the new interface
cat > "/etc/bird/bird.conf.d/50_${INTERFACE}.conf" << EOF
protocol bgp bgp_vm_peer_${INTERFACE} from bgp_vm_peer {
        local fe80::1;
        interface "${INTERFACE}";
}
EOF

chmod a+r "/etc/bird/bird.conf.d/50_${INTERFACE}.conf"
birdc configure
```

For the above to work, the referenced template `bgp_vm_peer` plus related configuration must also be present in the bird configuration:

```
# only import /32 loopback IPs from instances
filter import_vm_peer_ipv4 {
        if ! (net ~ [0.0.0.0/0{32,32}]) then reject;
        accept;
}

# only export a v4 default route to instances
filter export_vm_peer_ipv4 {
        if net ~ [0.0.0.0/0{0,0}] then accept;
        reject;
}

# only import /128 loopback IPs from instances
filter import_vm_peer_ipv6 {
        if ! (net ~ [::/0{128,128}]) then reject;
        accept;
}

# only export a v6 default route to instances
filter export_vm_peer_ipv6 {
        if net ~ [::/0{0,0}] then accept;
        reject;
}

template bgp bgp_vm_peer {
        neighbor fe80::2 external;
        local as 4200000000;

        ipv4 {
                import filter import_vm_peer_ipv4;
                export filter export_vm_peer_ipv4;
                next hop self;
                extended next hop;
        };
        ipv6 {
                import filter import_vm_peer_ipv6;
                export filter export_vm_peer_ipv6;
                next hop self;
                extended next hop;
        };
}
```

In short: 
- we only specify the local ASN of the Ganeti node, bird will accept any ASN from a VM peer
- we enable extended next-hop (to allow IPv4-over-IPv6-next-hop)
- we use filters to limit export/imports to something useful/sane, but YMMV :-)

For the `bird.conf.d` folder to work you need this line in your `bird.conf`:

```
include "/etc/bird/bird.conf.d/*.conf";
```

Starting with Ganeti 3.2, we do not have to rely on the `kvm-vif-bridge` hack any more and can use the `ext` network mode instead (but with roughly the same shell script). Along with the `ext` mode there's also now a `down` script so that we can properly clean up bird BGP sessions when an instance shuts down or migrates over to another node.

Within the instance, we need to configure our bird instance as well. This will be our BGP peer configuration (plus related snippets):

```
protocol direct {
        interface "dummy0";
        ipv4 {
                import all;
        };
        ipv6 {
                import all;
        };
}

filter export_ganeti_upstream_ipv4 {
        if ! (net ~ [0.0.0.0/0{32,32}]) then reject;
        if source = RTS_DEVICE then accept;
        reject;
}

filter export_ganeti_upstream_ipv6 {
        if ! (net ~ [::/0{128,128}]) then reject;
        if source = RTS_DEVICE then accept;
        reject;
}

protocol bgp ganeti_upstream {
  interface "eth0";
  neighbor fe80::1 external;
  local as 4200000001;

	ipv4 {
		import all;
		export filter export_ganeti_upstream_ipv4;
		extended next hop on;
		next hop self;
	};

	ipv6 {
		import all;
		export filter export_ganeti_upstream_ipv6;
		extended next hop on;
		next hop self;
	};
}
```

With these configurations in place both on nodes and inside instances we are now able to establish BGP sessions between `fe80::1` and `fe80::2` and exchange routes.

## A Word On Live Migration (And Why It Is So Slow)

By using DRBD as the storage backend, we are also able to leverage live migrations of instances between nodes. In our existing (layer 2 / bridged) clusters this works reasonably well so that we are live-migrating hundreds of instances each day to allow automated / unattended upgrades of the underlying Ganeti nodes. During a live migration, two things will impact the outcome:

- you need a fast enough network link (in terms of bandwidth and latency) between your Ganeti nodes so that the downtime / freeze window (in which QEMU transfers the last remaining bits of memory and CPU states) can be kept in the low milliseconds area
- your network needs to converge fast enough so that external network connections are not negatively affected

With layer 2, the latter is only a matter of your switches learning that a MAC address has moved between ports. QEMU helps this process by generating a gratuitous ARP packet right after migration has finished. But what about our new and shiny BGP-based setup? One thing right away: you won't get to sub-second failover times in a routed scenario. If this is a hard requirement, you will not get anywhere with this setup.

Let's go through the process of a live migration in a routed scenario step by step:

- Both QEMU processes are running and the source instance starts to copy memory contents over to the destination instance.
- Once that is done, QEMU will sync any changes that have been committed to the memory in the meantime and keep doing this in a loop until it determines that it will be able to copy the remaining changes *and* all BUS/CPU/register states within the timespan defined as the Ganeti parameter `migration_downtime`.
- When the QEMU process on the source node finishes/stops, Ganeti will clean up the associated TAP interface.
- Removing the interface breaks the BGP connection for bird running on the source node instantly (which will lead to a withdrawal of all prefixes originated by the instance, more on that later).
- However, the bird inside the instance doesn't notice anything at all because it still "thinks" it has an open BGP connection.
- Meanwhile, the bird process on the destination Ganeti Node has been informed about the new TAP interface and tries to establish a BGP connection to the new peer, possibly running into errors at first.

If your Ganeti nodes are co-located in the same datacenter and spine/leaf fabric, updates to your routing tables should propagate reasonably fast and migrating an instance should effectively only move the prefix announcement(s) from one physical port to another (or maybe to another switch in a neighboring rack). In our scenario we spread our test Ganeti cluster across two datacenters with separate spine/leaf fabrics, which are interconnected. Since everything is routed, this is no problem for instance movements. But it does mean that updates to your routing tables have to traverse more devices before they are effectively available to all of your systems, delaying the recovery times by a bit.

Long story short, the live migration itself will be as quick as always, but your instances' network will most probably take anywhere between 5 to 200 seconds to recover (with the majority in the > 120s area). Why is that? First off, we are speaking eBGP here. This is a protocol primarily used between internet routers, possibly exchanging hundreds of thousands of prefixes/routes. Receiving these routes, calculating best paths, converging routes etc. can be a very expensive and time consuming process and for that reason eBGP comes with very conservative timers for pretty much everything. It will not attempt to (re)connect aggressively and even the so called BGP hold timer (until a BGP session is considered dead) is commonly between 90 and 240 seconds. 

Also routers are usually applying a delay to route withdrawals in eBGP so that flapping routes or other unintended behaviour does not spread too quickly between autonomous systems/networks. Even if your instances' prefixes suddenly (re-)appear in a different corner of your network, the older routes might still be installed in routing tables across your devices.

## How To Improve Live Migration

Let's go through various ways of optimizing the network convergence. We'll start with a factor external to Ganeti nodes and instances: your network gear. Different vendors have different techniques to alter the aforementioned prefix withdrawal / advertisement delays. Some allow you to modify the timers directly (`min-route-advertisement` or `route-advertisement`), others use shortcut-settings like `rapid-withdrawal`. You should absolutely **not** modify these settings on devices with *real* external BGP peerings! It can be useful in an internal routing fabric where you *know* the amount of prefixes, the capabilities / performance of your devices etc. Also keep in mind that reducing the advertisement interval might also *create* future problems because unintended "short-lived" withdrawals (e.g. flapping prefixes due to bad cables) will propagate through your infrastructure much faster.

Depending on the size of your fabric / network you can observe the speed of route withdrawals easily with a tool like `mtr` or `traceroute`. While the instance is online, you will see the full routing path including the instance loopback IP. When you live-migrate the instance and the BGP session dies on the originating Ganeti node, the prefixes formerly announced by the instance will start to withdraw. While that happens, your `mtr` /  `traceroute` output will shorten hop-by-hop - with an observable delay inbetween. With optimizations in place, the routing path should collapse much faster. This will not primarily speed up the distribution of *new* prefixes (e.g. from the target Ganeti node), but will clean up stale routing table entries faster across your network.

Next, we will address the default BGP timers baked into bird. Let's start with (re)connect and error timers:

```
connect retry time 2;   # default: 120
error wait time 1,3;    # default: 60,300
error forget time 3;    # default: 300
```

Those three settings, added to a `bgp` section of bird, will *greatly* improve error recovery of a BGP session and also especially in the case of live migration. But there's still the issue of the BGP hold timer. After all, the bird process running inside the instance still assumes it is connected to a live BGP peer. While bird knows settings like `hold time <number>` or `keepalive time <number>` we are going to use something else that is more fit to the purpose: BFD, or bidirectional forwarding detection (as a fallback, you may still lower the hold and keepalive timers to something like 30 and 10 seconds). 

BFD is a general purpose protocol which can be used to detect end-to-end communication failures *quickly*. Most enterprise-grade switches and routers implement BFD at the hardware/ASIC level as it allows to detect failures in the range of milliseconds (whether you really *want* that is another story). Luckily, bird supports BFD out of the box. We'll enable BFD for all TAP interfaces on our Ganeti nodes:

```
protocol bfd bfd_vm_peer {
        accept ipv6 direct;
        interface "tap*" {
                interval 300ms;
                multiplier 3;
        };
}
```

`interval` means we are sending liveness packets every 300ms while `multiplier` tells us, that three consecutive packets must be missed before BFD declares the other end dead (essentially giving us a ~1 second detection window). Integration with BGP is rather simple: just add `bfd yes;` to the bgp template section. 

Inside your instances' bird configuration, we add this stanza:

```
protocol bfd bfd_ganeti_upstream {
        accept ipv6 direct;
        interface "eth0" {
                interval 300ms;
                multiplier 3;
        };
}
```

...and also enable BFD for our BGP peer configuration through `bfd yes;`. After reloading both bird services, we can track BFD states using `birdc` and the command `show bfd sessions`.

But what are the downsides of BFD? While it *is* there to speed up failure detection (or in our scenario: live migrations) and it absolutely does so, we need to keep in mind that there is no hardware or switch / router ASIC that helps us generate or receive BFD packets in a stable fashion. Depending on your workloads and instance resources a process going haywire inside your instance might clog your precious vCPU(s) just enough so that BFD on the node side declares the VM dead and hence drops all prefixes. You can either decide to ditch BFD altogether and play it safe or use more forgiving settings (e.g. `interval 2000ms; multiplier 4;`). You also must monitor your BFD sessions (e.g. with the [bird_exporter](https://github.com/czerwonk/bird_exporter)) because currently there is no way to configure BFD as *mandatory* within bird. If the BFD sessions fails to set up for whatever reason, BGP will happily continue without it. However, *if* it does initialize correctly, a subsequent BFD failure *will* trigger a reset of your BGP session as intended.

With all optimizations in place, we pushed our migration downtimes from a variable 7 - 200 second window down to a stable window of 6 - 8 seconds (across two datacenters with separate spine/leaf fabrics).

# Is it worth it?

Yes! kthxbye.

Jokes aside, what are pros of a pure layer 3 network (even without Ganeti)? First off, most applications do not care if they run on a system with layer 2 or layer 3 connectivity. They require an IP address to bind to and must be able to send and receive traffic. Unless you have a hard requirement on broad- or multicast, your applications probably will run in either environment equally well.

Getting rid of layer 2 also means you can ditch all those fun & ancient technologies like spanning tree, LACP, MCLAG, VRRP/CARP/HSRP and the like. OTOH, the technologies required to operate a layer 3 network (e.g. BGP) are in your toolbelt anways, *if* you operate your own AS. Also, you get traffic steering for free (draining links in advance instead of "pull-the-plug-and-hope-that-some-weird-technology-deals-with-that-properly", wow!).

Today, a new datacenter network architecture will almost always be based on a layer 3 underlay network. Those who really need layer 2 will add that as an extra layer on top with technologies like EVPN, vxlan and the like. So you get to build a fancy layer 3 network, than add some more technologies on top, only to be able keep using LACP, VRRP and whatnot *on top* of that. The only imaginable upside to this is: you do not need to touch any of your servers (virtual or physical).

Sure, there are downsides: going full layer 3 means added complexity on the server side. Be it bird, FRR or something else: you need some additional software to deal with BGP on your servers and it makes server deployment a tad more complicated (rest assured, we got that covered in a fully automated way both for hardware and virtual servers). But that is a trade-off we are willing to accept, given all the other technologies that are eliminated from our stack.
