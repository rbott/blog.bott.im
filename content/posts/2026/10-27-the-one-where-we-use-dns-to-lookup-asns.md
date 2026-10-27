---
title: "The One Where We Use DNS To Look Up ASNs"
description: "Building a useful Looking Glass service for a datacenter network with lots of private ASNs"
date: 2026-10-27
tags:
  - routing
  - bgp
  - netbox
  - lookingglass
  - dns
---

Why would I want to look up ASNs via DNS in the first place? Time for a little recap: In 2025 I wrote a [piece](https://blog.bott.im/bgp-unnumbered-in-2025-same-idea-different-implementations/) about the new layer-3-only datacenter network my team and I designed (and implemented) for my day job. A spine & leaf DC fabric usually means: one (private) ASN per device. That obviously includes spine and leaf switches but also hosts (bare metal and VMs), hypervisors, Kubernetes clusters and so on.

In a layer-3-only world you have a set of tools that help you answer network-related questions (or debug issues):

- traceroute / mtr / iproute2 and the local routing daemon on hosts
- "show" commands on network devices (`show route` and friends)

Most probably only a small subset of people have access to your network devices so the whole second category is not available to them. Even if they *have* access (e.g. read-only), they might not be familiar enough with the NOS you are running. But you can easily work around that by setting up a so-called Looking Glass service!

## Looking What?

Looking Glass services are not a new thing. On the contrary: they have been around for many years. Usually ISPs or autonomous systems in general run them to offer their (potential) customers, network engineers or generally interested parties insights into their routing tables. You can query said ASN's routes for a specific prefix and see if and how it can be reached from that ASN. Depending on the size you may (or have to) select a specific location / router to query against. Notable examples are [Deutsche Telekom](https://lookingglass.telekom.com/), [Hurricane Electric](https://bgp.he.net/super-lg/), [Arelion](https://lg.twelve99.net/) or [Lumen](https://lookingglass.lumen.com/). 

Earlier implementations let you directly query routers through a web interface (using SSH, netconf or even telnet internally) and then simply forward the device's output. This is clearly a bad design choice (for security reasons but also with regard to overloading production devices) and has mostly been replaced by indirect means of communication. A looking glass server may be a BGP peer on its own, use BMP (BGP Monitoring Protocol) to receive routing information or use some other means to receive/aggregate/query routing information without exposing any actual routing device to direct requests/queries.

Here is a non-curated list of looking glass implementations that work without accessing your live network devices:

- [Alice-LG](https://github.com/alice-lg/alice-lg)
- [Fernglas](https://github.com/wobcom/fernglas)
- [reflet](https://github.com/gmazoyer/reflet)
- [hyperglass](https://github.com/thatmattlove/hyperglass)
- [bird-lg-go](https://github.com/xddxdd/bird-lg-go) (Golang based rewrite of [bird-lg](https://github.com/sileht/bird-lg))

Disclaimer: some of them *do* allow you to interact with network devices directly, but they also support [bird](https://bird.network.cz/) or [FRR](https://frrouting.org/) which you can use as a local passive BGP route receiver (which then avoids interacting with production devices).

## How we built a looking glass service

Since we are happy users of the bird routing daemon, we went with `bird-lg-go` as our looking glass solution. We may test other setups in the future as well, but it worked right out of the box for us. The setup follows this schema:

<img src="/images/looking-glass01.png" alt="" />

We run a Linux VM with four instances of `bird` version 2 - one per router we want to connect to. While that *could* be handled with a single bird instance, I am currently not sure if that fits `bird-lg-go`'s design. Each `bird` operates two BGP sessions (one for IPv4, one for IPv6). YMMV, [multiprotocol BGP](https://www.rfc-editor.org/info/rfc4760/) *is* a thing :-)

There is one instance of `bird-lgproxy-go` per `bird` process and the single `bird-lg-go` process which serves the web frontend and talks to the four `bird-lgproxy-go` instances. Add a reverse proxy for TLS and authentication to the mix (e.g. [caddy](https://caddyserver.com/), [nginx](https://nginx.org/en/)) and you are all set.

For starters, here's a commented bird configuration that serves as a route receiver:
```ini
log syslog all;

router id 192.0.2.5;

protocol device {
  scan time 30;
}

# helper resolver tables
ipv4 table resolv4;
ipv6 table resolv6;

# helper protocols - otherwise all received routes from BGP peers
# will be "unreachable" and dropped
protocol static {
    ipv4 {
      table resolv4;
    };
    route 0.0.0.0/0 via "eth0";
}
protocol static {
    ipv6 {
      table resolv6;
    };
    route ::/0 via "eth0";
}

# if you run multiple bird instances, each needs a dedicated
# local/listening IP and "strict bind", otherwise bird will
# always bind to 0.0.0.0/[::]:179
# instead of dedicated IP addresses you can also use dedicated
# local ports for BGP, but that depends on whether the other
# end is able to configure alternative BGP ports
protocol bgp router_v4 {
    description "LG-Feed router IPv4";
    local 203.0.113.1 as 64512;
    neighbor 203.0.113.5 as 64512;
    multihop;
    ipv4 {
      import all;
      export none;
      igp table resolv4;
    };
    strict bind yes;
}
protocol bgp router_v6 {
    description "LG-Feed router IPv6";
    local 2001:db8::2:1 as 64512;
    neighbor 2001:db8::3:1 as 64512;
    multihop;
    ipv6 {
      import all;
      export none;
      igp table resolv6;
    };
    strict bind yes;
}
```

## So where's DNS now?

Let's test this setup with a random public IP address: 100.150.200.5

<img src="/images/looking-glass02.png" alt="bird-lg-go bgpmap output for 100.150.200.5" />

From the map we can see that our network reaches the given IP address through a path of AS13237, AS6461 and finally AS21928. We also get the ASNs nicely resolved to the respective company names EuNetworks, Zayo and T-Mobile USA. How does that work? `bird-lg-go` supports the DNS ASN lookup interface, as provided by [Team Cymru](https://www.team-cymru.com/ip-asn-mapping#dns). It works by deriving a hostname from the ASN in question and querying that through DNS:

```shell
$ dig +short TXT AS21928.asn.cymru.com
"21928 | US | arin | 2002-06-12 | T-MOBILE-AS21928 - T-Mobile USA, Inc., US"
```

The data corresponds to the information you would get from a WHOIS request:

```shell
$ whois AS21928

ASNumber:       21928
ASName:         T-MOBILE-AS21928
ASHandle:       AS21928
RegDate:        2002-06-12
Updated:        2012-02-24
Ref:            https://rdap.arin.net/registry/autnum/21928

OrgName:        T-Mobile USA, Inc.
OrgId:          TMOBI
Address:        12920 SE 38th Street
City:           Bellevue
StateProv:      WA
PostalCode:     98006
Country:        US
RegDate:        2003-01-02
Updated:        2017-01-28
Ref:            https://rdap.arin.net/registry/entity/TMOBI
```

Not only is this DNS interface blazingly fast, it also makes use of your local caching resolver. Cymru's name servers return the TXT records with a TTL of 86400 seconds (aka 24 hours). Unknown ASNs return NXDOMAIN answers.

## Private ASNs everywhere!

Now that we have established that we get insights into the reachability of public destinations, let's try an internal destination:

<img src="/images/looking-glass03.png" alt="bird-lg-go bgpmap output for an internal target, only showing unresolved internal ASNs" />

Well that's a bummer. As stated earlier, each device in our routed fabric has its own ASN. We are using the private ASN range, separated into sub-ranges (e.g. 4200000000 to 4200099999 are spine devices). Of course Cymru's name servers will happily return NXDOMAIN for each DNS request now, leaving us with a rather meaningless AS path. But wasn't one of our initial goals to help non-network people debug reachability and routing?

But fear not, help is near! Fortunately we organize all of our ASNs in [Netbox](https://github.com/netbox-community/netbox) and can use that as our source of truth. This is possible through this little helper service: [netbox-asn-resolver](https://github.com/sipgate/netbox-asn-resolver). It acts as a DNS proxy between you and Cymru's name servers.

To set up `netbox-asn-resolver`, you need a custom subdomain (e.g. `asn-lookup.yourproject.com`) and create a NS record which points at the host running `netbox-asn-resolver`. Upon startup it will connect to your Netbox instance, consume all ASNs via its REST API and update that list regularly in the background. When a DNS request in the form of `AS123456.asn-lookup.yourproject.com` arrives, it will do the following:

- check cached Netbox data if the ASN exists and return that data
- return NXDOMAIN if Netbox has no record of that ASN *and* the ASN belongs to a private ASN range
- query `AS123456.asn.cymru.com` and forward that answer (either a TXT record or NXDOMAIN)

<img src="/images/looking-glass04.png" alt="bird-lg-go bgpmap output for an internal target, now showing proper internal/private AS information from Netbox" />

Now that looks better! Here is a slightly larger example of an anycasted IP address that is available in multiple locations:

<img src="/images/looking-glass05.png" alt="bird-lg-go bgpmap output for anycasted IP address with multiple parallel paths and internal/private AS information from Netbox" />

A word on privacy: since this is DNS, the `netbox-asn-resolver` service must listen on port 53. However, it does not need to be publicly reachable - as long as the DNS resolver your `bird-lg-go` system uses is able to reach it.

A word on resource usage: the setup is very light. A single `bird` instance with a full table uses around 250MB of memory, `bird-lg-go` and `bird-lgproxy-go` are in the low two-digit range. CPU and network load are also entirely negligible.

## Where to go from here?

As I said earlier, there are also other options for looking glass services - both UI-wise but also on the backend. The above mentioned [fernglas](https://github.com/wobcom/fernglas/) supports both extra routing information through BMP *and* ASN resolution via DNS (would also work with `netbox-asn-resolver`).

Additionally, there is the so-called [BGP Add-Path](https://www.rfc-editor.org/info/rfc7911/) feature which allows a router to not only send the *best* path, but all other known paths for a destination as well. That allows you to observe fallback/inactive routing paths from your looking glass. `bird` supports it - you only need to check if your routers support it and what the increased information load does to your looking glass server resources.

In any case we have reached our stated goal: make routing information on your network more accessible to non-network people. It will only get better from here!
