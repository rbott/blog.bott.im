---
title: Ganeti Hardware Considerations
description: What kind of hardware to choose when building a new Ganeti cluster.
date: 2024-01-17
tags:
  - ganeti
---
Building a new virtualisation cluster will require spending money on hardware at some point. To avoid underutilisation, unwanted overbooking or extremely unbalanced resource usage you need to make some decisions early on and then calculate based on those.

For the sake of simplicity, we will assume that we are using DRBD as the only storage backend for our cluster. This implies that each instance will allocate its entire disk space on exactly two nodes of the cluster. If we would be using some sort of centralized storage (through e.g. `sharedfile` in Ganeti) we would require half the disk space from a Ganeti point of view.

## To RAID or Not to RAID?
DRBD is often referred to as “network RAID 1”. So if there is already a RAID 1 across the network, why would I need another RAID/redundancy level on the physical server? Let’s go through an example situation:

A disk in one of your nodes fails:
- with RAID: your software or hardware RAID will hide away the problem from Ganeti and your instances. You can schedule a disk replacement at your discretion and you are done. You even have the time to live-migrate all running instances off the affected node if required.
- without RAID: all instances on the affected disk will stall/die. Unless you are using harep, your on-call staff needs to manually restart the affected instances on their secondary node and have Ganeti choose a new replication target. Only after that you can deal with the replacement of the defective disk.

If your VM SLAs allow for the latter case, you can save a lot of money on hardware. This will come at the cost of more work each time a disk dies. Otherwise I really suggest to go with RAID on your nodes for peace of mind and easier maintenance.

## N+1 Redundancy
In case a node fails, Ganeti assumes that all affected instances will be started on their secondary node (remember, we are using DRBD storage so there is always one designated backup node).
On a well balanced three node cluster, we can assume that primary instances on node A are split evenly between nodes B and C with their secondary configurations. That means Ganeti will reserve enough headroom on nodes B and C to cater for the node A instances.
Should your cluster become so unbalanced that N+1 redundancy can not be guaranteed anymore, Ganeti will warn you.
Remember: with DRBD, storage will be allocated on instance creation on both the primary and secondary (and hence is “visible” as allocated). CPU and memory allocations of course are only “visible” while an instance is running. Hence on a “full” but well designed (and also well balanced) cluster, your disk usage will show 100% on all nodes, but some CPU cores and memory still seem to be available on each node.

#TODO: Node Liste von vollem Cluster anzeigen

## Ratios? All I hear Is Ratios!
Ganeti knows two types of ratios. The first one is quite useful, the other one is more a relic of old times and usually bites you when you expect it the least.

The so-called vCPU ratio determines the overcommitment of CPU cores. If you do not want that to happen at all, set this ratio to 1. If you want to allow two guest CPU cores per each real CPU core, set it to 2.
You should choose your value based on customer SLAs or expected workloads (e.g. full blown prod systems or just idling test systems). Please keep in mind that if you have hyperthreading enabled Ganeti will count these as real cores with regards to the CPU ratio.

The so-called spindle ratio dates back to when spinning disks were the default. It also dates back to an assumption made by Google “back in the day”: Ganeti nodes do not operate on expensive hardware RAIDs which hide the disk topology from the OS. Each visible disk raises the spindle count by one. Before we had SSDs or even NVMEs, a good way to entirely kill the performance of a disk was concurrent access to different areas of said disk. 
To limit the negative effect of multiple instances hammering on the same disk, the spindle ratio can be used to limit the number of instances that are allocated to a node based on its amount of disks available. However, with a hardware RAID in place (which might span two or even twenty-something disks) Ganeti still only ‘sees’ one disk and sets the spindle count accordingly.
Each instance has a spindle count of `1` - you can manually override that with any number to indicate that this instance “uses” more spindles (e.g. does some I/O heavy stuff).
When the instance allocator hits the spindle ratio limit, it will error out with the `FailDisk` return value - which unfortunately is the same as e.g. “not enough disk space available”. An hour of confused debugging will follow.
Unless you are trying to achieve something specific with the spindle ratio, you should just set it to something like 1024, so it never gets in your way.

## Know Your Workloads
Last but not least you need to have at least some idea of the sizing of your instances on your future cluster. To make calculations easier (read: possible) you need to define a default instance size, say 4 vCPUs, 8GB memory, 40GB disk. With that, you can start your calculations.
If you have no idea at all what kind of instance sizing to expect, you will inevitably end up with an unbalanced/underutilized cluster which might hit e.g. its disk capacity while leaving most of its memory unused.

## How Many Instances Per Node?
That probably depends on the question: how many missing instances can you tolerate? Let’s assume you will run applications on your cluster that are usually spread across five backend instances. If you size your nodes so that your entire cluster will fit on three nodes you will end up with two backend instances sharing a node with a backend instance of the same application. If one of these nodes fails, you will lose two backend instances of the same application at the same time. In that case it would be smarter to downsize your nodes a bit so that you can have five physical nodes to spread your instances evenly without buying excess hardware.
What you also should take into account: while it is absolutely possible to cram 160 primary instances on a single node you need to consider the amount of time it takes to live-migrate all of them away in case of a planned maintenance. 

## Can I Extend My Cluster At a Later Point?
Yes, but you really should not. Unless you can still get the exact same hardware. There are two main reasons here:
with DRBD, your instance’s write speed will be determined by the slower end. If your newer nodes have faster storage but an instance happens to have its secondary configured on an older node, your instance’s disk writes will be slowed down by the older node.
On top of that, all nodes should have the exact same CPU type. This way, you can pass through the node’s CPU model to the guest (instead of emulating some common subset of CPU features, which is possible but not recommended). This is only relevant if you plan to use live migration though.

For the exact same reasons it is also not recommended to build a production cluster from leftover hardware with mixed configurations.

## Network
My Ganeti nodes use three separate network connections (each using two physical ports in a Linux bonding interface):
Node network - this holds the node’s main IP address (used to SSH into it for management). This interface will also hold the master IP address managed by Ganeti and carry all Ganeti management traffic (1GBit/s is totally fine here).
Instance Bridge - this bridge is connected to an external interface that carries all instance traffic (usually using a vlan aware bridge) so that it is entirely separate from the node/management/storage traffic (chose interface speed depending on your instance’s workload/requirements).
Storage/Migration network (also called “secondary” network by Ganeti) - this is a separate network/vlan that connects all nodes of the cluster together and will be used by Ganeti for DRBD replication and live migration (this should be at least 10GBit/s or faster, depending on your storage).

With the above setup you ensure that your instance, storage replication, live migration or node management traffic can never get into each other’s way.

## Cluster Capacity Monitoring
So you finally have that cluster built, up & running. How do you figure out that you are running out of resources before the allocation of a new instance fails? Ganeti has you covered here: you can simulate instance allocation with a tool called hspace and learn how many instances of a given configuration/size still fit in your cluster. The new Prometheus Ganeti Exporter comes with hspace integration so you can easily built alerting for this as well.

## Conclusion
There are many factors that should be taken into account when planning a new virtualisation cluster. Some aspects are probably not even specific to Ganeti. Sooner or later you will end up with a spreadsheet with all sorts of formulas to make the live of N+1 calculations, vCPU ratios and storage requirements easier.
