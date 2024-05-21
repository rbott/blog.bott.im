---
title: Automating Firewall Testing on Linux
description: How to make sure two iptables/nftables rulesets actually allow/block the same traffic?
date: 2024-05-20
tags:
  - iptables
  - nftables
  - testing
  - network security
  - network namespaces
---

A while ago my work team was assigned the task to migrate one firewall generator into a different one. Output were `iptables` rules for Linux servers in both cases. As we wanted to ensure a smooth transition, we were looking for a way to actually test the new rulesets before being deployed into production. A little bit of googling did not yield any results, so we came up with our own solution.

The same approach should work when transitioning from `iptables` to `nftables` but we have not tested that. In our scenario the firewall systems were acting as gateways for layer 3 segments (vlans) with multiple layer 3 upstream interfaces, roughly with the following topology:

<img src="/images/firewall-topology.svg" alt="Routing Firewall Topology" />

This blog post will explain the overall methology but it does not come with ready-to-use code. You have to figure that last part out yourself and adapt it to your infrastructure :-)

## The Secret Sauce

Contrary to what you might believe, we will not be using any bleeding edge technology here. Everything that is required has been around for ages:

- [tcpdump](https://www.tcpdump.org/)
- [Linux Network Namespaces](https://man7.org/linux/man-pages/man7/network_namespaces.7.html)
- [iproute2](https://man7.org/linux/man-pages/man8/ip-netns.8.html)
- [veth Interfaces](https://man7.org/linux/man-pages/man4/veth.4.html)
- Bash, Python and [Scapy](https://scapy.net/) (this is not a hard requirement, other languages / packet generators can be used as well)

## What Are Network Namespaces?

The concept of network namespaces was introduced back in 2002 with Linux Kernel 2.4.19. It allows for a complete separation of the Linux network stack - interfaces can only be present in _one_ network namespace and will not be visible/usable from any other namespace. Essentially it is the foundation of all modern container networking. Each network namespace has its own interfaces, routing tables, firewall rules, connection tracking and sockets/listeners. Linux also supports [VRFs](https://www.kernel.org/doc/Documentation/networking/vrf.txt), which is a different concept and only cares about a separation of layer 3 / routing information and can not be used for isolation / security purposes.

Linux uses the `iproute2` package to create/manage network namespaces from the command line, more specific the `ip netns` command. Most important commands are:

- `ip netns list` - list existing namespaces (the system's default namespace will not be listed)
- `ip netns add <name>` - create a new namespace with identifier `<name>`
- `ip netns exec <name> <cmd>` - run `<cmd>` restricted to namespace `<name>`, e.g. run `/bin/bash` to debug the namespace (list visible interfaces, routes etc.)
- `ip link set dev <int> netns <name>` - assign inteface `<int>` to namespace `<name>`

## What Are veth Interfaces?

`veth` are virtual ethernet devices which can be used to connect two namespaces to each other. They always come in pairs with both ends residing in different namespaces, the following example is directly taken from the [veth man page](https://man7.org/linux/man-pages/man4/veth.4.html):

```shell
ip link add <p1-name> netns <p1-ns> type veth peer <p2-name> netns <p2-ns>
```

We will use these devices to allow packets to flow from one namespace to the next.

## A Word on Python and Scapy

In our scenario we have used Python and the Scapy library, mainly because we already knew Python. Scapy is an easy way to work with PCAPs and packet generation in Python. However, neither Python nor Scapy are exactly fast in what they are doing. We worked around those issues by using Python [multiprocessing](https://docs.python.org/3/library/multiprocessing.html) which gave us a reasonable improvement both for parsing PCAPs and also for generating test traffic.

If you need more performance and you are more of a Go(lang) person, there are libraries for [PCAP reading](https://github.com/dreadl0ck/gopcap) and [packet generation](https://github.com/atoonk/go-pktgen), but I do not have any experience with those.

## From A Bird's Eye View

In essence we will be doing the following:

- capture traffic on the existing firewall(s) entering or leaving a specific vlan *after* it has been allowed by the firewall ruleset
- analyse the PCAPs and generate a de-deduplicated list of *valid* traffic flows (using Python/Scapy)
- analyse iptables logs to find flows which have been *rejected* by the firewall to generate a de-duplicated list of *invalid* traffic flows (using plain Python)
- create and connect three namespaces: *sender*, *firewall* and *receiver*
- re-generate traffic & evaluate the results

### Capture Allowed Traffic & Gather Test Data

To test our new firewall ruleset, we need test data. Ideally both for traffic that must *pass* the firewall but also traffic which must be *blocked*. If you skip the latter you may actually overlook that your shiny new firewall simply allows any packets to pass :-) 

We will be using `tcpdump` to gather data on traffic flows that are actually *allowed* to pass the firewall. For this to work we need to dump traffic *after* it has been processed by the firewall. If we stick with the example from above, traffic entering `vlan 100` (198.51.100.0/26) must be captured on interface `bond0.100` while traffic leaving this vlan must be captured on *both* upstream interfaces `eth0` and `eth1`.

To keep the amount of data stored on disk to a minimum (and thus allow for dumping data for longer periods of time) we can use some tricks:

- only store 44 Bytes of package data, we are only interested in layer 3 + 4 header data
- for TCP: only capture TCP SYN packets, this is all we need to figure out that a (new) TCP stream has been allowed by the firewall
- for UDP: only capture packets with a destination port < 15.000 (unless you _know_ that you have UDP services listening on higher port numbers), that way you can filter out UDP reply traffic to a certain extent (e.g. answers to DNS queries)
- implement a ring buffer with `-C` and `-W` parameters, that way `tcpdump` will not fill up your disk but instead start to overwrite old data when the configured limits in numbers-of-files and megabytes-per-file have been reached

YMMV entirely, depending on the types of traffic in your network you may need to broaden or narrow your filters. Also, we are mostly running Debian Linux and we know that other Distributions/OSes have lower limits for source ports than 15.000. You might need to adapt your port filter to filter out further UDP reply traffic.

Following are two examples how to gather traffic for our example `vlan 100` in both directions:

```shell
# incoming
export INTERFACE=bond0.100
export NETWORK=198.51.100.0/26
sudo tcpdump -s 44 -ni $INTERFACE -w incoming_${INTERFACE}_traffic.pcap -C 50 -W 20 "dst net $NETWORK and ((tcp[tcpflags] & (tcp-syn) != 0 and tcp[tcpflags] & (tcp-ack) == 0) or (udp dst portrange 1-9999))"

# outgoing
export INTERFACE=eth0
export NETWORK=198.51.100.0/26
sudo tcpdump -s 44 -ni eth0 -w outgoing_${INTERFACE}_traffic.pcap -C 50 -W 20 "src net $NETWORK and ((tcp[tcpflags] & (tcp-syn) != 0 and tcp[tcpflags] & (tcp-ack) == 0) or (udp dst portrange 1-9999))"

export INTERFACE=eth1
export NETWORK=198.51.100.0/26
sudo tcpdump -s 44 -ni eth1 -w outgoing_${INTERFACE}_traffic.pcap -C 50 -W 20 "src net $NETWORK and ((tcp[tcpflags] & (tcp-syn) != 0 and tcp[tcpflags] & (tcp-ack) == 0) or (udp dst portrange 1-9999))"
```

These PCAPs will now contain lots of duplicated flows (e.g. DNS requests, short lived HTTP sessions etc.) which will only hog resources and extend testing time without providing any real value. Consider that your firewall ruleset might not work on the first attempt and you need to fix stuff and re-run the tests over and over again.
This is where the PCAP-reading capability of Scapy comes into play: we can analyze the aquired PCAPs, remove duplicate traffic and store the resulting data in a format that will be easier to parse (e.g. CSV) for the actual test runs.

The following Python script will analyse all given PCAP files (using Python multiprocessing to parse in parallel), create a CSV file as its output, recognize UDP, TCP, SCTP and GRE flows, eleminating duplicates on the way:

```python
#!/usr/bin/env python3

import argparse
import csv
from multiprocessing import Pool

from scapy.all import *

# configure enabled layers for dissecting
conf.layers.filter([Ether, IP, ICMP, TCP, UDP, SCTP, GRE])
# configure/overwrite payload guessing for specific protocols
Ether.payload_guess = [({"type": 0x800}, IP)]
TCP.payload_guess = []
UDP.payload_guess = []


def main():
    parser = argparse.ArgumentParser(description='Prepare Input for nqfilter fw testing.')
    parser.add_argument('--input', '-i', help='List of pcap files', nargs='+', default=[])
    parser.add_argument('--output', '-o', help='Output file name', default='prepared_input.csv')

    args = parser.parse_args()

    with Pool() as pool:
        print("starting workers")
        parsed_pcaps = pool.map(parse_pcap, args.input)

    print("All workers finished, writing csv file")
    used_flows = set()
    start_time = time.time()
    written_rows = 0
    with open(args.output, 'w', newline='') as csvfile:
        writer = csv.writer(csvfile, delimiter=';')
        writer.writerow(['connection_type', 'src_ip', 'src_port', 'dst_ip', 'dst_port'])
        for data in parsed_pcaps:
            for row in data:
                flow_tuple = (row["proto"], row["src_ip"], row["dst_ip"], row["dst_port"])
                if flow_tuple not in used_flows:
                    written_rows += 1
                    used_flows.add(flow_tuple)
                    writer.writerow([row["proto"], row["src_ip"], row["src_port"], row["dst_ip"], row["dst_port"]])

    end_time = time.time()
    duration = end_time - start_time
    print("Wrote %d lines in %ds" % (written_rows, duration))


def parse_pcap(file):
    used_flows = set()
    return_flows = []
    processed_packets = 0
    start_time = time.time()

    with PcapReader(file) as packets:
        for packet in packets:
            processed_packets += 1
            if packet.haslayer(IP):
                src_ip = packet[IP].src
                dst_ip = packet[IP].dst
                if packet.haslayer(UDP):
                    layer4_proto = UDP
                    proto_string = 'UDP'
                elif packet.haslayer(TCP):
                    layer4_proto = TCP
                    proto_string = 'TCP'
                elif packet.haslayer(SCTP):
                    layer4_proto = SCTP
                    proto_string = 'SCTP'
                elif packet.haslayer(GRE):
                    layer4_proto = GRE
                    proto_string = 'GRE'
                else:
                    continue

                src_port = packet[layer4_proto].sport
                dst_port = packet[layer4_proto].dport
                flow_tuple = (layer4_proto, src_ip, dst_ip, dst_port)

                if flow_tuple not in used_flows:
                    used_flows.add(flow_tuple)
                    return_flows.append({
                        "proto": proto_string,
                        "src_ip": src_ip,
                        "src_port": src_port,
                        "dst_ip": dst_ip,
                        "dst_port": dst_port})

    end_time = time.time()
    duration = end_time - start_time
    print("Processed %d packets in %ds" % (processed_packets, duration))
    return return_flows


if __name__ == "__main__":
    main()
```
It would be invoked as follows (with the PCAPs in the same folder):
```shell
EXPORT=bond0.100
./prepare_input.py -i incoming_${INTERFACE}_traffic.pcap* -o incoming_${INTERFACE}_traffic.csv
./prepare_input.py -i outgoing_${INTERFACE}_traffic.pcap* -o outgoing_${INTERFACE}_traffic.csv
```

This will provide you with two CSV files containing the fields: protocol, source IP, destination IP, source port, destination port.

### Capture Blocked Traffic & Gather Test Data

Our firewall systems use ulogd to log dropped packages. It provides us with a logfile (say `/var/log/firewall/firewall.log`) with lines similar to that:

```
May 20 09:00:00 fancy-firewall IN=eth0 OUT=bond0.100 MAC=aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:00:00 SRC=1.2.3.4 DST=192.51.100.88 LEN=60 TOS=00 PREC=0x00 TTL=48 ID=16114 PROTO=TCP SPT=17499 DPT=443 SEQ=2838500987 ACK=0 WINDOW=42340 SYN URGP=0 MARK=0 
```

We can build a simple parser script with e.g. string splitting or regular expressions, find the lines that concern our network (either in `DST` or `SRC`) and build a CSV file similar to the `prepare_input.py` script above. This way we get a list of packets which have been *blocked* by our existing firewall (either entering or leaving the network).

### Setup The Namespaces

The general idea of the namespaces is that packets are generated inside the `sender` namespace. There is only one interface `veth0`, which connects this namespace to the `firewall` namespace. A default route in the `sender` namespace makes sure that each and every packet generated actually gets forwarded to the `firewall` namespace. That in turn is connected to the `receiver` namespace through `veth2`, again with a default route pointed to the `receiver` namespace. This way any packets generated in the `sender` namespace will inevitably end up in the `receiver` namespace *unless* there are firewall rules active in the `firewall` namespace which block forwarding.

<img src="/images/firewall-namespaces.svg" alt="Firewall Namespace Layout" />

The following shell script will set up the actual namespace environment (and also cleanup existing ones of the same name beforehand):

```shell
#!/bin/bash

set -e

if [ "$UID" -ne 0 ]; then
    echo "Please run as root!"
    exit 1
fi

insert_firewall_rules() {
    # add whatever is required to load your firewalls rules inside the 
    # firewall namespace, e.g.:

	  # cat firewall-rules | ip netns exec firewall iptables-restore
    # ip netns exec firewall /path/to/firewall-script.sh
}

exec_ns() {
    ip netns exec $*
}

cleanup() {
    for netns in sender firewall receiver; do
        ip netns del ${netns} || true
    done
}



cleanup

# enable ip forward
echo 1 > /proc/sys/net/ipv4/ip_forward

# setup sender namespaces
ip netns add sender
ip netns add firewall
ip netns add receiver

# setup veth pairs
ip link add veth0 netns sender   type veth peer veth1 netns firewall
ip link add veth2 netns firewall type veth peer veth3 netns receiver

# enable veth interfaces
exec_ns sender   ip link set up dev veth0
exec_ns firewall ip link set up dev veth1
exec_ns firewall ip link set up dev veth2
exec_ns receiver ip link set up dev veth3

# setup sender IP
exec_ns sender   ip a a 192.168.1.1/30 dev veth0

# setup firewall IPs
exec_ns firewall ip a a 192.168.1.2/30 dev veth1
exec_ns firewall ip a a 192.168.1.5/30 dev veth2

# setup receiver IP
exec_ns receiver ip a a 192.168.1.6/30 dev veth3

# configure default routes sender -> firewall -> receiver
exec_ns sender   ip r a default via 192.168.1.2
exec_ns firewall ip r a default via 192.168.1.6

# generate/insert firewall rules into namespace
insert_firewall_rules
```

You need to modify the function `insert_firewall_rules()` and add whatever logic you need to load your ruleset. There are two caveats you need to take care of before injecting your firewall rules into the `firewall` namespace:

- if your iptables rules contain interface name matchers (e.g. `-i eth0` or `-o bond0.100`) you need to replace them with `sed` to use `-i veth1` and `-o veth2`
- if your iptables rules make use of `REJECT` (either ICMP unreachable or TCP resets) you need to replace that with a silent `DROP`. Otherwise the ICMP or Reset packets will end up on the receiver namespace and confuse the test evaluation

This script uses IP addresses from `192.168.1.0/24` to route packets between the namespaces. If these addresses are also used in your infrastructure/part of your test data, you **must** use different addresses to not break/confuse your firewall testing. 

### Sending Packets

The following Python script will generate packets as defined in the given CSV file. It uses multiprocessing to speed up testing and needs to be executed in the `sender` namespace:

```python
#!/usr/bin/env python3

import argparse
import csv
from multiprocessing import Pool, RLock

from scapy.all import *
from tqdm import tqdm


def main():
    parser = argparse.ArgumentParser(description='Send packets from a csv file.')
    parser.add_argument('--input', '-i', help='CSV file')
    parser.add_argument('--workers', '-w', default=80, type=int, help='Number of workers to send packets')
    args = parser.parse_args()

    with open(args.input, newline='') as csvfile:
        total_packet_count = sum(1 for row in csvfile) - 1

    with open(args.input, newline='') as csvfile:
        packets = csv.reader(csvfile, delimiter=';')
        next(packets)

        tqdm.set_lock(RLock())
        with Pool(processes=args.workers) as pool:
            list(tqdm(pool.imap(send_packet, packets), total=total_packet_count, unit="packets"))


def send_packet(packet):
    layer4_proto = packet[0]
    src_ip = packet[1]
    src_port = int(packet[2])
    dst_ip = packet[3]
    dst_port = int(packet[4])
    if layer4_proto == 'TCP':
        send(IP(src=src_ip, dst=dst_ip) / TCP(sport=src_port, dport=dst_port, flags='S'), verbose=False)
    elif layer4_proto == 'UDP':
        send(IP(src=src_ip, dst=dst_ip) / UDP(sport=src_port, dport=dst_port), verbose=False)
    elif layer4_proto == 'GRE':
        return
    elif layer4_proto == 'SCTP':
        sctp_packet = IP(src=src_ip, dst=dst_ip) / SCTP(sport=src_port, dport=dst_port) / SCTPChunkInit( init_tag=5,a_rwnd=106496,n_out_streams=2,n_in_streams=2,init_tsn=11 )
        send(sctp_packet, verbose=False)

if __name__ == "__main__":
    main()
```

It can be invoked as follows (`-w` sets the amount of parallel workers to use and depends on your test machine):

```shell
sudo ip netns exec sender ./send_packets.py -i incoming_bond0.100_traffic.csv -w 200
```

### Detecting Packets On The Receiver Side

Again, we can use `tcpdump` to capture any packets which enter the `receiver` namespace:

```shell
sudo ip netns exec receiver tcpdump -nli veth3 -w test_capture.pcap ip
```

The above command should be executed right before `send_packets.py` gets invoked and can be stopped once `send_packets.py` has finished its job. For a complete result, we need to run three tests in a row:

- send incoming packets which have been allowed by the current firewall (gathered from PCAP)
- send outgoing packets which have been allowed by the current firewall (gathered from PCAP)
- send packets (both directions) which have been blocked by the current firewall (gathered from iptables log)

### Evaluating Test Results

We can re-use what we already have and create a CSV file from the PCAP we have just aquired in the `receiver` namespace:

```shell
./prepare_input.py -i test_capture.pcap -o test_capture.csv
```

We now have a CSV of the packets that were generated and another CSV of packets which were received. Ideally, both should be exactly the same. To validate this, we can make use of the shell commands `cat`, `sort` and `diff`.

```shell
cat test_capture.csv | sort > test_capture_sorted.csv
cat incoming_${INTERFACE}_traffic.csv | sort > incoming_${INTERFACE}_traffic_sorted.csv

diff incoming_${INTERFACE}_traffic_sorted.csv test_capture_sorted.csv
```

How to read the diff?

- lines prefixed `<`: the packet has been sent, but not received (which means a firewall rule is blocking it although it should not)
- lines prefixed `>`: the packet has *not* been sent, but received (that seriously should never occur :-) )

Evaluating the "blocked packets" test is a bit easier: we only need to make sure `tcpdump` has recorded exactly zero packets on the `receiver` namespace. If anything has passed the firewall (although it should not), we can look at the PCAP and see which packets have passed.

### Bringing All Of That Together

If you need to carry out the above steps often, it helps to automate the following steps:

- prepare copy/paste `tcpdump` statements for a given vlan/interface
- collect PCAPs and log files from firewall systems
- create CSV files from them
- prepare namespaces
- start `tcpdump` on the `receiver` namespace (e.g. using a multithreaded script/application)
- run `send_packets.py` on the `sender` namespace
- stop `tcpdump`
- create CSV files again and compare test data

We have built that, too. Again, using Python. But since the whole script is heavily customized around internal infrastructure, I can not share it here.

## Things To Consider

Capturing live traffic for testing/validation works best with short-lived connections. It might fail to detect very long running TCP streams as well as irregular connections. If you know your infrastructure well you will probably have a rough idea when dumping traffic will yield the best results (e.g. include scheduled backup runs, automatic maintenance reboots, software deployments, cover at least 24 hours etc.). That said you will get a pretty decent idea if your new firewall ruleset does the same as the old one before did. However, you might still miss one flow or another.

