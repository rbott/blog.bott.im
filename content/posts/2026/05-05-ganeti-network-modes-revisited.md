---
title: "Revisiting Ganeti's Network Modes"
description: "There's a little bit of dust on Ganeti's networking - let's refresh it for the upcoming version 3.2!"
date: 2026-05-05
tags:
  - ganeti
  - network
  - routing
  - qemu
  - kvm
  - bridged
---

As one of the Ganeti maintainers, I've spent a fair bit of time in the network configuration code over the past weeks. With version 3.2 about to land - bringing the first meaningful changes to that part of the codebase in a while - this is a good moment to walk through the network modes Ganeti offers, their use cases, and the improvements landing in 3.2.

For quite a while now, Ganeti has supported three distinct modes of network operation. You can choose your flavor(s) for each instance network interface separately with the `mode` parameter (`bridged`, `openvswitch` or `routed`). For clarity: the network mode is *not* set on instance level, but on NIC level. You may mix-and-match multiple modes on a single instance with multiple virtual NICs.

# Bridged - The Traditional One

Ganeti supports standard Linux bridges, both vlan-aware and non-vlan-aware bridges. From a system point of view there is nothing more to prepare than to create the bridge(s), add an external interface to it and you are done. Ganeti will take care of the rest. If you use vlans, you have two options:

- Use standard bridges and create one bridge per vlan (and add a tagged upstream interface like `bond0.150` or `eth0.150` to it). Assign an instance NIC to a specific vlan by assigning the corresponding bridge device (e.g. `link=br150`).
- Use a single vlan-aware bridge and let Qemu take care of (un)tagging traffic by configuring the instance NIC parameter `vlan=.150`. This greatly simplifies/unclutters the network configuration on your Ganeti nodes.

Bridged networking is probably the most common setup out there, mostly due to its simplicity and ease of use.

# Open vSwitch - The Bridge On Steroids

[OVS](https://www.openvswitch.org/) shines where standard bridges run out of steam. If you run an overlay network (e.g. VXLAN or GRE-based), need flow-based traffic forwarding rules or complex ACLs, Open vSwitch enters the game. As with standard bridges, you are responsible for providing the OVS setup yourself. Ganeti will take care of adding/removing instance interfaces (along with vlan configuration) but will not manage any other aspects of OVS.

I have no real operational experience with OVS, so I'll leave it at that.

# Routed - But Not In The Way You Might Think

There has been a `routed` network mode in Ganeti for a long time. In today's context, "routed" sounds like something something BGP and friends. But with Ganeti, "routed" actually only refers to the way the traffic flows between the node and the instance. Outside connectivity is still assumed to be layer 2. Each `routed` instance NIC requires its `ip` parameter to be filled with an IPv4 or IPv6 address. Upon instance start, the following happens on the node:

- a TAP interface is created to represent the node side of the instance NIC
- a route to `$IP` is installed on the node, pointing at the TAP interface
- Proxy ARP is enabled on the TAP interface

You also need to enable Proxy ARP on your public node interface. Inside the instance you configure `$IP` on your virtual network device and add a default route which points to that device (e.g. `ip route add default dev eth0`).

So how does traffic actually flow? Let's start with the inbound direction: when a neighboring layer 2 device emits an ARP request for your instance's IP address, the Ganeti node will reply on behalf of your instance (thanks to Proxy ARP on the public interface), receive the following IP packet and forward it - following its local route - to the instance's TAP interface. Tada, you now have a working mix-and-match combination of layer 2 and layer 3 for your instance connectivity.

The outbound direction is where the other Proxy ARP setting comes in. Because the instance has a default route using `dev eth0` (without a gateway IP), it will emit an ARP request for any destination IP it wants to talk to. With Proxy ARP enabled on the TAP interface, the host responds to each of these requests with the MAC of the TAP interface, causing the instance to send all traffic to the host, which then proceeds with standard routing from there.

There are two operational gotchas worth knowing about: every unsolicited inbound probe from the public internet - and there's a lot of that - causes the instance to issue an ARP request for the source IP, which in turn creates a neighbor table entry on the instance. The instance's ARP table size therefore scales with internet background noise rather than with anything meaningful. It is not an essential problem, but noisy and potentially confusing when debugging network issues. Side note: if you firewall traffic on the instance and decide to simply drop all unsolicited packets, you will greatly reduce the size of your ARP table. ARP requests are only emitted if the instance wants to answer (e.g. reply with TCP reset or ICMP unreachable packets).

The second gotcha affects live migration: when live-migrating a `routed` instance over to another node, a fresh TAP interface with a *different* (auto-assigned) MAC address will be created on the new node. However, all of the IPs sitting in the instance's ARP cache will still point to the *old* MAC address and communication with these IP addresses will be dead until the garbage collection process of the kernel kicks in (which also means: the old entries will not necessarily expire at the same time). If both `routed` mode and live migration are important to you, you can mitigate this issue by using the hack mentioned in the next chapter and always assign each and every TAP interface across all nodes the very same MAC address (yes, that works entirely fine and does not cause any trouble as each TAP/virtual-nic pair forms its own layer 2 domain).

# How To Hack Ganeti Networking

In Ganeti 3.1 and earlier, you'll find a somewhat strange looking shell code snippet in the `kvm-ifup` script:

```shell
if [ -x "$CONF_DIR/kvm-vif-bridge" ]; then
  exec $CONF_DIR/kvm-vif-bridge
fi
```

In most cases, `$CONF_DIR` equals `/etc/ganeti` - so if the executable file `/etc/ganeti/kvm-vif-bridge` exists, it will be executed *instead* of the current shell script. Since this happens ahead of the function calls which *would* configure routed/ovs/bridged networking, you can essentially replace all of Ganeti's configuration logic with your own. However, some limitations apply:

- Ganeti still assumes the network mode you have set on the NIC level and will validate/enforce their relevant parameters (e.g. `routed` requires `ip` to be given and you cannot have two NICs with the same `ip` value for obvious reasons)
- During instance live migration, `bridged` and `openvswitch` NICs will be configured *ahead* of the migration while `routed` NICs will be configured *after* migration has finished

The original reasoning behind `kvm-vif-bridge` predates my involvement in the project, and I consider it mostly a hack due to the above limitations (and the script's rather odd name). But if you need to customize Ganeti's network initialization code, this is the place to look.

# A Look Into The Future: Down-Scripts, Modding And Ext Mode

After tinkering around with the Ganeti network code for a while I decided the project deserves better. So I revisited the Ganeti network configuration subsystem and came up with this (merged) pull request: [PR #1919: Redesign KVM ifup logic and add optional ifdown scripts](https://github.com/ganeti/ganeti/pull/1919). It addresses the following issues/shortcomings/feature requests:

- All network modes now feature a "down" script hook (currently a no-op for `routed`, `bridged` and `openvswitch`). This implements an older pending [design doc](https://github.com/ganeti/ganeti/blob/master/doc/design-ifdown.rst).
- All network modes allow for customization: they check the existence of `/etc/ganeti/network/$mode/$action` (where `$action` would be `up` or `down`) and branch out to that if present.
- There is a new network mode `ext` which is specifically meant to implement a custom network type. You can use all available NIC parameters (`link`, `vlan`, `ip`, `network` etc.) but Ganeti will not enforce/validate any inputs. You can place your scripts/executables in `/etc/ganeti/network/ext/` and you can also decide whether you want to configure the network ahead or after an instance live migration.
- It added [extensive documentation](https://github.com/ganeti/ganeti/blob/master/doc/network.rst) for all network modes (linked is the source-code version for now as no official version of Ganeti 3.2 has been released yet).

While this will not be backported to the `stable-3.1` branch, it will be part of the upcoming Ganeti 3.2 release. If **you** think you can benefit from the new network mode and spot bugs or missing features, please do not hesitate to open an [issue](https://github.com/ganeti/ganeti/issues) or start a discussion on the [mailing list](https://ganeti.org/community.html).

# A Brief Detour: macvtap

I briefly thought about adding `macvtap` as a fifth network mode as there seem to be noticeable performance improvements over standard Linux bridges. But then again it will just add a third variant of bridging, and so far there has not been much demand for that technology.

There seems to be a "forgotten" [implementation](https://docs.ganeti.org/docs/ganeti/2.18/html/design-macvtap.html) in the abandoned 2.17/2.18 versions. These were the last Ganeti versions authored by Google, but they never left the alpha stage and were discontinued when the Ganeti community took over the project from Google and pushed the Python 3 conversion forward, starting off from the last stable version 2.16 and then transitioning to Ganeti 3.0.

# What's Up Next?

If I find the time, I will also release blog posts on other new features that shape the Ganeti 3.2 release - stay tuned!
