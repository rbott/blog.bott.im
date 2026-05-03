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

Bridged networking is probably the most common setup out there, mostly due to its simplicity and easy of use.

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

There are two operational gotcha worth knowing about: every unsolicited inbound probe from the public internet - and there's a lot of that - causes the instance to issue an ARP request for the source IP, which in turn creates a neighbor table entry on the instance. The instance's ARP table size therefore scales with internet background noise rather than with anything meaningful. It is not an essential problem, but noisy and potentially confusing when debugging network issues.

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
- All network modes allow for customization: they check the existance of `/etc/ganeti/network/$mode/$action` (where `$action` would be `up` or `down`) and branch out to that if present.
- There is a new network mode `ext` which is speficially meant to implement a custom network type. You can use all available NIC parameters (`link`, `vlan`, `ip`, `network` etc.) but Ganeti will not enforce/validate any inputs. You can place your scripts/executables in `/etc/ganeti/network/ext/` and you can also decide whether you want to configure the network ahead or after an instance live migration.
- It added [extensive documentation](https://github.com/ganeti/ganeti/blob/master/doc/network.rst) for all network modes (linked is the sourcecode version for now as no offical version of Ganeti 3.2 has been released yet).

While this will not be backported to the `stable-3.1` branch, it will be part of the upcoming Ganeti 3.2 release. If **you** think you can benefit from the new network mode and spot bugs or missing features, please do not hesitate to open an [issue](https://github.com/ganeti/ganeti/issues) or start a discussion on the [mailing list](https://ganeti.org/community.html).

# Ganeti Setup

A quick word on Ganeti itself in layer-3-only environments: the setup was no different from regular installations. As stated earlier, each host has its public /32 loopback IP address configured on a `dummy0` interface. We assigned an extra /32 loopback address as the cluster master IP and configured `dummy0` as the master network device. Ganeti will configure the extra /32 IP address on the master node, `bird` will pick up the extra address and announce it to the leaf switches. Things like DRBD storage replication also worked right out of the box. Ganeti does not make any assumptions about the network which might break in such a layer-3-only environment.

# The Easy Way: Non-BGP-Aware Instances

We tried to follow the KISS principle: just use what's there. We set our example instance's NIC to `routed`, stored its loopback IP address in the `ip` parameter and modified our `bird` configuration to pick up all static /32 routes from the kernel routing table and export them via BGP to the leaf switches. We configured the loopback IP address on the `eth0` interface inside the instance, configured a default route via `dev eth0` et voilà: we have IP connectivity from our instance.

Pro's:
- No BGP/bird inside the VM required (less moving parts)
- Live migration works with a downtime of ~10 seconds, but only if the above mentioned workaround with the static TAP MAC address is used

Con's:
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

First off, we need to establish how the node and instances communicate. To keep it simple, we will use IPv6 link-local addresses and have Ganeti always assign `fe80::1` on the TAP interface while the instance always configures `fe80::2` on its virtual interface `eth0`. To verify this works, we can use `ping fe80::1%eth0` inside our instance or `ping fe80::2%tapX` on our node, where `tapX` is the TAP interface that corresponds to our test instance.

# Conclusion

TODO: write