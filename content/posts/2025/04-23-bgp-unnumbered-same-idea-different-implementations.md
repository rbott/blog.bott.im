---
title: "BGP Unnumbered in 2025: Same Idea, Different Implementations."
description: "Once you've gotten your hands on BGP unnumbered, it is hard to go back. But it is far less of a standard than you might expect."
date: 2025-04-23
tags:
  - bgp
  - unnumbered
  - linux
  - bird
  - juniper
  - junos
  - nokia
  - srlinux
  - link-local
  - ipv6
disclaimer:
  text: This post has been updated on 2025-04-24 (see end of page)
---

It started with a simple idea: what if everything in our data center was routed - not just the core-routers and -switches, but the access layer and the hosts too? So that’s exactly what we did. No VXLAN, no EVPN, no fancy overlays - just plain Layer 3.

This blog post offers insights into the technologies we used and the challenges we encountered along the way. Although our setup involved Nokia 7220 and Juniper QFX gear, along with the Bird BGP implementation on Linux hosts, this post won’t include ready-to-use configuration snippets. Instead, it focuses on the core technologies and concepts behind our approach.

Our setup is following this network layout:

<img src="/images/spine-leaf.svg" alt="Spine Leaf Network Design" />


## OMG So Many IP Addresses!!11

So we are building a setup with tons of Layer 3 links - which means tons of IP transfer networks. Have a lot of devices? Then you'll have **a lot** of transfer networks to configure. Oh, and we are going dual stack. So... double that.

Sure, with solid automation and some [Netbox](https://github.com/netbox-community/netbox) wizardry, it’s doable. But do not underestimate the effort when you go down that route.

What if I told you, you don't need all of that?

Let's throw in some buzzwords / RFCs:

- IPv6 link-local addressing ([RFC 7404](https://datatracker.ietf.org/doc/html/rfc7404))
- IPv6 Router Advertisements ([RFC 4861](https://datatracker.ietf.org/doc/html/rfc4861))
- BPG unnumbered / BGP dynamic peers (no RfC here)
- IPv4 over IPv6 Next Hop (~~[RFC 5549](https://datatracker.ietf.org/doc/rfc5549)~~ [RFC 8950](https://datatracker.ietf.org/doc/rfc8950/)) 

You can build your entire setup without the need of assigning even a single IPv4 or IPv6 transfer network. How? Let's go through the required technologies:

### IPv6 link-local

I will not deep-dive into the concept of IPv6 link-local addresses (LLAs) here - there is plenty of material on that matter available. In short: each network interface on an IPv6-enabled system will auto-assign itself a locally unique IPv6 from the fe80::/10 prefix (*locally unique* refers to the layer 2 segment reachable from that specific interface). It is entirely valid to manually assign the *same* LLA to multiple interfaces on the same system (e.g. fe80::1/64), as these addresses are never routed and only valid in the scope of each interface. However, no other system connected to any of these interfaces may use fe80::1, otherwise DAD (duplicate address detection) will kick in.

If you want to connect to a remote link-local address, you must also provide the associated interface in the notation `[ip-address]%[interface]`, otherwise your network stack will not be able to figure out over which interface to send the packets (example: `ping fe80::1%eth0`).

[RFC 7404](https://datatracker.ietf.org/doc/html/rfc7404) specifically describes the usage of LLAs in network infrastructure.

Routing protocols like OSPF use multicast to discover neighboring routers and they work out of the box with LLAs. But what if you want to use BGP as a routing protocol? BGP peers are usually configured statically using the IP address of the peer. Since we do not know the remote LLA, we need some means of detecting it dynamically.

### IPv6 Router Advertisements And BGP Unnumbered / BGP Dynamic Peers

Network vendors have come up with a term called "BGP dynamic peers" or "BGP unnumbered". To the best of my knowledge it does not follow a specific standard/RFC, but the configuration process is basically:

- enable IPv6 Router Advertisements (e.g. each device will advertise itself as a router, announcing its LLA that way to neighboring devices)
- configure BGP dynamic peers with some match critera (e.g. the remote ASN or a range of accepted ASNs)

As soon as the network device receives a router advertisement on an interface configured for dynamic BGP peers, it will configure a BGP neighbor on-the-fly, connect, validate that e.g. the remote ASN is in the accepted range and start exchanging routes. From that point on, the BGP session is no different than any statically configured BGP session. You can use policies to reject, accept or modify incoming or outgoing routes.

There is one minor operational issue to keep in mind: if a link and the associated dynamic BGP peer goes down, the network device will remove the peer configuration immediatly. Traditional monitoring of BGP session states will not detect this because dynamic BGP neighbors/sessions are either up/established or do not exist at all.

This works at least for Nokia (tested with srlinux 24.10) and Juniper devices (tested with Junos 23.4). On Linux hosts both [FRR](https://frrouting.org/) and [Bird](https://bird.network.cz/) support dynamic peers. While FRR is able to send router advertisements on its own, you need to pair Bird with [radvd](https://github.com/radvd-project/radvd) to achieve the same.

With the Nokia srlinux devices it is also possible to skip the router advertisements between hosts and leaf switches:

- configure `fe80::1/64` on each host-facing leaf interface and activate dynamic BGP neighbors
- configure static BGP sessions in FRR/Bird with `fe80::1` as the remote address

That way, hosts will actively try to establish BGP connections to a well-known address (while the leaf switch is actually waiting for a router advertisement). This did not work on JunOS because it restricts BGP connections to source addresses which must be announced through a router advertisement first (which will in turn trigger JunOS to connect to the host). This is not a major drawback, but it allows you to skip radvd on the host when using Nokia gear.

### But What About IPv4?

Unfortunatly legacy IP is still a requirement, isn't it? But hey, people already thought about that problem and came up with two cool solutions: 
- BGP is able to transport routing information independent of the actual protocol used to establish the BGP session (e.g. you can transport IPv4 routes in an IPv6-based BGP session - [RFC 4760](https://datatracker.ietf.org/doc/html/rfc4760))
- BGP is able to transport IPv4 prefixes with an IPv6 next hop (well at least if both implementations support [RFC 8950](https://datatracker.ietf.org/doc/rfc8950/))

Multiprotocol BGP is not exactly news, but how (or why?) does signalling IPv4 routes with an IPv6 next hop work?

Technically, a router does not need the IP address of a neighboring router to route an IP packet. After all it does not modify the IP packet during the routing process. But what it **does** need is the MAC address and the outgoing interface, because it will remove its own MAC address from the ethernet frame, replace it with the next hop's MAC address and put that frame on the appropriate wire (granted, that explanation is a bit simplified here). Next hop IP addresses are a convenient way to look up both information (neighbor MAC address and outgoing interface) but the IP address *itself* is not involved in the "real" routing part.

Hence, it may look strange but it is entirely valid to have an IPv4 prefix in your routing table with an IPv6 next-hop.

If your BGP daemon and routing stack support RFC8950, you can save yourself a lot of trouble and get along with IPv6-only BGP sessions in an IPv6-only transport network but still announce/transport IPv4 prefixes and have them reachable.

On a Linux host, your IPv4 routing table would contain entries like this (example uses ECMP):
```shell
198.18.0.0/24 proto bird metric 32 
	nexthop via inet6 fe80::1 dev enp5s0f0 weight 1 
	nexthop via inet6 fe80::1 dev enp5s0f1 weight 1 
```

### But What About Traceroute, ICMP etc.?

How does ICMP(v6) work, if there are no public routable addressess involved on any network device (and no IPv4 at all)? Simple answer: it won't work. You do need exactly one IPv4 and one IPv6 GUA loopback IP per switch. They will use this IP address to source ICMP(v6) packets (e.g. "time exceeded" packets during traceroute operation) and hence this IP address (or the associated name) will be visible in traceroutes. You will never see any interface-specific IP addresses, as there are only unroutable link-local addresses which can never source any kind of informational/error packet.

## Sounds Great, But Why Does It Violate RFCs?

As I noted earlier, "BGP unnumbered" is not exactly a standard. And frankly, it even outright contradicts existing RFCs. This is not a problem if you stay with one vendor but it gets complicated if you go multi-vendor. Let's cite another RFC here ([RFC 2545](https://datatracker.ietf.org/doc/html/rfc2545)) on the construction of the next hop field inside a (multiprotocol) BGP update:

> A BGP speaker shall advertise to its peer in the Network Address of
> Next Hop field the global IPv6 address of the next hop, potentially
> followed by the link-local IPv6 address of the next hop.
> 
> The value of the Length of Next Hop Network Address field on a
> MP_REACH_NLRI attribute shall be set to 16, when only a global
> address is present, or 32 if a link-local address is also included in
> the Next Hop field.

In other words: the next hop address field **must** contain the next hop's global IPv6 address and **may also** contain its link-local IPv6 address as a secondary information. But our setup does not include any GUAs, only LLAs. What now? Let's look at three implementations (output taken from Wireshark):

**Nokia:**
```
Path Attribute - MP_REACH_NLRI
    [...]
    Next hop: fe80::1
        IPv6 Address: fe80::1
```

**Juniper:**
```
Path Attribute - MP_REACH_NLRI
    [...]
    Next hop: IPv6=fe80::1 Link-local=fe80::1
        IPv6 Address: fe80::1
        Link-local Address: fe80::1
```

**Bird (versions up to 2.16):**
```
Path Attribute - MP_REACH_NLRI
    [...]
    Next hop: IPv6=:: Link-local=fe80::3efd:feff:fe1a:1b40
        IPv6 Address: ::
        Link-local Address: fe80::3efd:feff:fe1a:1b40
```

Nokia puts the link-local address in the field which is supposed to *only* carry a global unicast address. There is no additional link-local field.
Juniper on the other hand populates both the GUA and the LLA field with the same link-local address.
Bird somewhat adheres to the RFC and puts the link-local address only into the appropriate link-local field. But for that to work, it must put *something* into the GUA field first - they decided to go with empty IPv6 address (translating into `::` in Wireshark).

Also, Bird contains code to [fix incoming BGP updates when an LLA has been put into the GUA field](https://gitlab.nic.cz/labs/bird/-/blob/stable-v2.16/proto/bgp/packets.c?ref_type=heads#L1358-1376). That means: BGP updates flowing from Nokia or Juniper devices towards Bird work just fine. However, the other way round they do not. Let's see what both BGP implementations have to say about BGP updates received from Bird:

**Nokia:**
```
In network-instance public, a path attribute of type 14 and length 42 that was received in a route from the neighbor fe80::3efd:feff:fe1a:1b40-"ethernet-1/1.0" was considered malformed.
In network-instance public, a route for NLRI fd00::10:32:1:1/128 was received from neighbor fe80::3efd:feff:fe1a:1b40-"ethernet-1/1.0" and it was considered withdrawn because of a recoverable error in the UPDATE message
```

**Juniper:**
```
BGP_UNUSABLE_NEXTHOP: bgp_nexthop_sanity: peer fe80::3efd:feff:fe1a:1b40%xe-0/0/0.0 (External AD IPv6-ND) next hop :: unexpectedly remote, ignoring routes in this update (instance public)
```

We observed the above problem using Bird 2.0.12 from Debian Bookworm but also with a manual build of the (at that time) latest version 2.16. We applied a very small/hackish patch so that Bird used the same next hop encoding as Nokia et voilà: both Nokia and Juniper devices accepted our BGP updates.

Since the BGP unnumbered usecase contradicts RFC 2545, I do not think there is any specific side to blame here. One *could* argue both Nokia and Juniper should relax their BGP parsers to be a bit less strict.

Eventually Bird fixed this issue on their end with [this patch](https://gitlab.nic.cz/labs/bird/-/commit/f4a94644d0d6a4ecdf5fcebb0062bc463fad2a28). Bird 2.17 introduced a new configuration setting `link local next hop format`, which defaults to `native` but also accepts `single` and `double` to mimic the behaviour of either Nokia or Juniper. We tested this version against the Nokia implementation and it works like a charm.

## Bottom Line

BGP unnumbered is not a brand new concept. You can easily find online resources [dating back to 2015 (Ivan Pepelnjak's ipSpace Blog)](https://blog.ipspace.net/2015/02/bgp-configuration-made-simple-with/). It has evolved to some sort of defacto-standard but never made it into its own RFC. Nevertheless the advantages of such a network setup are obvious. You can build a large datacenter fabric with many many leafs and even more connected hosts with only very few lines of (generic) configuration on each network device. Just be aware that mixing vendors might get you into trouble here (even more than usual).


## Update on 2024-04-24

Great news! As pointed out by [Roberta Maglione on LinkedIn](https://www.linkedin.com/feed/update/urn:li:activity:7321115702701015040?commentUrn=urn%3Ali%3Acomment%3A%28activity%3A7321115702701015040%2C7321160434563067904%29&dashCommentUrn=urn%3Ali%3Afsd_comment%3A%287321160434563067904%2Curn%3Ali%3Aactivity%3A7321115702701015040%29) a [draft RFC has been published](https://datatracker.ietf.org/doc/html/draft-white-linklocal-capability-06) in March which addresses excactly the problem described above. It expires in September 2025, so let's see where this draft leads us.

The intended implementation is split into three parts:
- a new BGP capability which signals the other end that LLA-only routing updates are a) sent and b) understood
- allow the MP_REACH_NLRI next-hop field to contain *only* a link-local address or a combination of GUA and LLA
- specify exactly which error conditions exist and how to handle them

Thanks Roberta for providing that information!
