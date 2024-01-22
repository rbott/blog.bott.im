---
title: Ganeti Hardware Considerations
description: Sizing and building a new Ganeti cluster requires some serious thinking.
date: 2024-01-22
tags:
  - ganeti
---
Building a new virtualisation cluster will require spending money on hardware at some point. To avoid underutilisation, unwanted overbooking or extremely unbalanced resource usage you need to make some decisions early on and then calculate based on those.
This post tries to help with some of these decisions. It is entirely biased by the types of Ganeti clusters I have built so far, so as usual YMMV :-)

For the sake of simplicity, we will assume that we are using DRBD as the only storage backend for our cluster. This implies that each instance will allocate its entire disk space on exactly two nodes of the cluster. Other storage options are outside the scope of this blog post.

## To RAID or Not to RAID?
DRBD is often referred to as “network RAID 1”. So if there is already a RAID 1 across the network, why would I need another RAID/redundancy level on the physical server? Let’s go through an example situation:

A disk in one of your nodes fails:
- with RAID: your software or hardware RAID will hide away the problem from Ganeti and your instances. You can schedule a disk replacement at your discretion and you are done. You even have the time to live-migrate all running instances off the affected node if you want to reduce risk.
- without RAID: all instances on the affected disk will stall/die. Unless you are using `harep`, your on-call staff needs to manually restart the affected instances on their secondary node and choose new secondary nodes, if you have enough space left on your remaining nodes. Only after that you can deal with the replacement of the defective disk.

If your VM SLAs allow for the latter case, you can save a lot of money on hardware. This will come at the cost of more work each time a disk dies. Otherwise I really suggest to go with RAID on your nodes for peace of mind and easier maintenance.

## N+1 Redundancy
In case a node fails, Ganeti allows you to (re-)start the failed instances on their secondary node. While disk allocation is visible on both nodes with DRBD, memory and CPU is not. Ganeti will keep track of these resources for you and while it allows you to "fill up" a node with manual instance placement, it will warn you if N+1 redundancy has been lost via [`gnt-cluster verify`](https://docs.ganeti.org/docs/ganeti/3.0/html/man-gnt-cluster.html#verify). Automatic allocation through [`hail`](https://docs.ganeti.org/docs/ganeti/3.0/html/man-hail.html) will also fail with error `FailN1` if allocating another instance will violate N+1 redundancy.

On a well balanced three node cluster, we can assume that primary instances on node A are split evenly between nodes B and C with their secondary configurations. That means Ganeti will reserve enough headroom on nodes B and C to cater for the node A instances.
If your cluster becomes unbalanced over time (due to instance resizing or manual instance placements), `gnt-cluster verify` will let you know. If you are using automatic allocation, you can try to rebalance your cluster with [`hbal`](https://docs.ganeti.org/docs/ganeti/3.0/html/man-hbal.html).

## Ratios? All I hear Is Ratios!
Ganeti knows two types of ratios. The first one is quite useful while the other one is more a relic of old times and usually bites you when you expect it the least.

The so-called *vCPU ratio* determines the overcommitment of CPU cores. If you do not want that to happen at all, set this ratio to 1. If you want to allow two guest CPU cores per each real CPU core, set it to 2.
You should choose your value based on customer SLAs or expected workloads (e.g. overcommitting might be a good idea for dev/test systems but not for production usage). Please keep in mind that if you have hyperthreading enabled Ganeti will count these as real cores with regards to the CPU ratio.

The so-called *spindle ratio* dates back to when spinning disks were the default. It also manifests an assumption made by Google "back in the day": Ganeti nodes do not operate on expensive hardware RAIDs which hide the disk topology from the OS. The spindle count of a node will equal the amounts of disks visible to the OS. Before we had SSDs or even NVMEs, a good way to entirely kill the performance of a disk was concurrent access to different areas of said disk. 
To limit the negative effect of multiple instances hammering on the same disk, the spindle ratio can be used to limit the number of instances that are allocated to a node based on its amount of disks available. However, with a hardware RAID in place (which might span two or even twenty-something disks) Ganeti still only "sees" one disk and sets the spindle count accordingly.
Each instance has a spindle use count of `1` - you can manually override that with any number to indicate that this instance "uses" more spindles (e.g. does some I/O heavy stuff).
When the instance allocator hits the spindle ratio limit, it will error out with the `FailDisk` return value - which unfortunately is the same as e.g. "not enough disk space available". An hour of confused debugging will follow.
Unless you are trying to achieve something specific with the spindle ratio, **you should just set it to something like 1024, so it never gets in your way**.

Boths ratios can be set during [cluster initialisation](https://docs.ganeti.org/docs/ganeti/3.0/html/man-gnt-cluster.html#init) or using [`gnt-cluster modify`](https://docs.ganeti.org/docs/ganeti/3.0/html/man-gnt-cluster.html#modify) using the parameters `--ipolicy-vcpu-ratio` and `--ipolicy-spindle-ratio`.

## Know Your Workloads
You need to have at least some idea of the sizing of your instances on your future cluster. To make calculations easier (read: possible) you need to define a default instance size, say 4 vCPUs, 8GB memory, 40GB disk. With that, you can start your calculations. 
If you have no idea at all what kind of instance sizing to expect, you will inevitably end up with an unbalanced/underutilized cluster which might hit e.g. its disk capacity limit while leaving most of its memory unused.

## How Many Instances Per Node?
That probably depends on the question: how many missing instances can you tolerate? Let’s assume you will run applications on your cluster that are usually spread across five backend instances. If you size your nodes so that all of your instances will fit on three nodes you will end up with two backend instances sharing a node with a backend instance of the same application. If one of these nodes fails, you will lose two backend instances of the same application at the same time. In that case it would be smarter to downsize your nodes a bit so that you can have five physical nodes to spread your instances evenly without buying excess hardware.
What you also should take into account: while it is absolutely possible to cram 160 primary instances on a single node you need to consider the impact on your business if they fail at the same time and also the amount of time it takes to live-migrate all of them away in case of a planned maintenance. 

## Can I Extend My Cluster At a Later Point?
In theory, yes but you probably should not. Unless you can still get the exact same hardware. There are two main reasons here:
with DRBD, your instance’s write speed will be determined by the slower end. If your newer nodes have faster storage but an instance happens to have its secondary configured on an older node, your instance’s disk writes will be slowed down by the older node.
On top of that, all nodes should have the exact same CPU type. This way, you can pass through the node’s CPU model to the guest (instead of emulating some common subset of CPU features, which is possible but not recommended). This is only relevant if you plan to use live migration though.

For the exact same reasons it is also not recommended to build a production cluster from leftover hardware with mixed configurations.

## Network
My Ganeti nodes use three separate network connections (each using two physical ports in a Linux bonding interface):

- Node network - this holds the node’s main IP address (used to SSH into it for management). This interface will also hold the master IP address managed by Ganeti and carry all Ganeti management traffic (1GBit/s is totally fine here).
- Instance Bridge - this bridge is connected to an external interface that carries all instance traffic (usually using a vlan aware bridge) so that it is entirely separate from the node/management/storage traffic (chose interface speed depending on your instance’s workload/requirements).
- Storage/Migration network (also called "secondary" network by Ganeti) - this is a separate network/vlan that connects all nodes of the cluster together and will be used by Ganeti for DRBD replication and live migration (this should be at least 10GBit/s or faster, depending on your storage).

With the above setup you ensure that your instance, storage replication, live migration or node management traffic can never get into each other’s way.

## Cluster Capacity Monitoring
So you finally have that cluster built, up & running. How do you figure out that you are running out of resources before the allocation of a new instance fails? Ganeti has you covered here: you can simulate instance allocation with a tool called [`hspace`](https://docs.ganeti.org/docs/ganeti/3.0/html/man-hspace.html) and learn how many instances of a given configuration/size still fit in your cluster. The new [Prometheus Ganeti Exporter](https://github.com/ganeti/prometheus-ganeti-exporter/) comes with `hspace` integration so you can easily build alerting for this as well.

## Cluster Sizes
While Ganeti allows you to build clusters of tens or in theory even hundreds of nodes, I would not recommend to do so. Depending on the cluster activity, the job queue might sooner or later become the bottleneck. Long running `gnt-cluster verify` jobs are queued between instance creation jobs, live migrations or other mainteance tasks. There are only few jobs which lock the entire cluster (most job locks are node-local) but still you will end up with waiting times. Upgrading a cluster will take a long time to complete and possibly affect your regular operations during that time.

With smaller clusters (e.g. 5-7 nodes) you can still reach a good availability but with smaller failure domains. The chances of running the exact same hardware in smaller clusters is also improved. On top of that, Ganeti supports [migrating instances between clusters](https://docs.ganeti.org/docs/ganeti/3.0/html/move-instance.html) (no live migration!). This allows you to upgrade a cluster by setting up a new one and migrating all instances to the new cluster when your hardware or operating system goes EOL.

## Sample Formulas

You can use the following formulas to do your own math using your favorite spreadsheet software. Here are the required input variables with disk/memory sizes assumed in gigabytes:

- Parameters of your standard instances (use averages, medians or a default instance size if you have one)
  - `$InstanceDiskSize`
  - `$InstanceMemorySize`
  - `$InstanceCpuCount`
- Parameters of your nodes / cluster
  - `$NodeDiskSize` (as visible to the operating system)
  - `$NodeMemorySize`
  - `$NodeCpuCount`
  - `$NodeCount`
  - `$CpuRatio`

Based on the above, you can now calculate:

- `$ClusterFailSafeStorage = (( $NodeDiskSize - ( $NodeDiskSize / $NodeCount )) * $NodeCount ) / 2`
- `$ClusterFailSafeMemory = (( $NodeMemorySize - ( $NodeMemorySize / $NodeCount )) * $NodeCount )`
- `$ClusterFailSafeCpus = (( $NodeCpuCount - ( $NodeCpuCount / $NodeCount )) * $NodeCount ) * $CpuRatio`

And again with these information you can calculate the maximum amount of instances allocatable based on disk, memory and cpu constraints:

- `$MaxInstancesByDisk = $ClusterFailSafeStorage / $InstanceDiskSize`
- `$MaxInstancesByMemory = $ClusterFailSafeMemory / $InstanceMemorySize`
- `$MaxInstancesByCpu = $ClusterFailSafeCpus / $InstanceCpuCount`

Those three values should be equal or at least be very close to each other. If that is the case, you have found hardware and cluster settings which are a perfect match to your assumed instance size! If not, you can adjust the following input variables to achieve a better result:

- number of Ganeti nodes (to achieve the desired redundancy level or adhere to rackspace constraints)
- amount of disk space or memory (e.g. due to hardware limitations or price/performance ratio)
- amount of CPU cores available
- desired CPU ratio



## Conclusion
There are many factors that should be taken into account when planning a new virtualisation cluster. Some aspects are probably not even specific to Ganeti. If you have other recommendations or experiences, please share them with me on [Mastodon](https://chaos.social/@rbo_ne)!
