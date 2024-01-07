---
title: Introduction to Ganeti
description: Ganeti is a virtualisation cluster solution ranging from few to hundreds of VMs.
date: 2024-01-01
tags:
  - ganeti
disclaimer:
  text: Being one of the maintainers of the Ganeti project, some views might be biased here :-) 
---

During the next weeks and months I will publish a series of blog posts about [Ganeti](https://ganeti.org). It is a virtual machine cluster management solution which started as an internal project at Google and saw its first public release in August 2007. With the beta release of Ganeti 3.0 in June 2020, development has officially been taken over by the Ganeti Community from Google.

## But What Does It Actually Do?
Ganeti can be used on a single system to spawn local VMs using KVM or Xen (think of an alternative to libvirt). However, its strength is running in clustered environments, operating dozens or even hundreds of VMs across many physical nodes. 

To achieve this, Ganeti builds upon existing technology. VM Storage can be local or replicated (using DRBD, Ceph, Gluster or custom solutions), VM connectivity can be implemented using linux bridges, Open vSwitch or in a routed fashion. Virtualisation builds upon KVM, Xen (both HVM and PVM) or LXC (which is still present in the codebase, but not maintained as of now). 
The primary way of managing/interacting with Ganeti are versatile CLI commands, but there is also a REST API available for integration into existing automation solutions.

## Does It Do High Availability?
That’s a definitive maybe. First of all, you need to select a storage backend that supports replication of some sorts. Currently that would be either DRBD, RBD (Ceph) or GlusterFS. Ganeti also supports a file based approach where Ganeti assumes that replication of these files is handled outside of Ganeti (e.g. a shared NFS mount). With either of these storage backends in place you can live migrate VMs between nodes and also start them on another node if the formerly primary node unexpectedly dies. While Ganeti will restart a crashed VM (through a periodically running maintenance process) on its original node, it will not automatically switch a VM to a backup node. This must be done manually by a human. You can use the tool [harep](https://docs.ganeti.org/docs/ganeti/3.0/man/harep.html) that ships with Ganeti for a more automated approach, but I have never used that so far.

For all disaster scenarios I have encountered "eventual availability" was more than enough. If you run a production environment on Ganeti with loadbalancers, backends etc. I assume there is redundancy already on your application level (active/passive loadbalancers with keepalived, multiple backends etc.) which gives you enough time budget to failover VMs to other nodes and/or repair the broken node without actual service impact.

If you are looking for fully automated, split-second recovery from failing hardware, Ganeti might not be the solution for you.

## Resource Allocation
While you can allocate VMs manually across your cluster nodes, Ganeti can and should do that automatically for you. This will ensure that your cluster always maintains a N+1 state where one node may fail at any time and the remaining nodes have enough spare resources to host the additional workload. You can also tag your VMs so that multiple instances of the same application do not end up on the same physical node.

## Cluster/Node Maintenance
Using the CLI or the API you can easily drain a node and (live) migrate all running instances to other nodes or rebalance the entire cluster after maintenance work. There is also [tooling](https://docs.ganeti.org/docs/ganeti/3.0/man/hroller.html) available that helps you plan maintenance of nodes.

## OS Providers
How to set up new VMs, you may ask? Ganeti has a concept of so called OS providers. Most widely used is probably the [deboostrap OS provider](https://github.com/ganeti/instance-debootstrap) (also available as a package on Debian) which creates Debian or Ubuntu installations using the debootstrap tool and custom hooks. There are also many community providers available which make use of e.g. prebuilt images. You may also use the so-called “no-op OS provider” (also available as Debian package) which tells Ganeti to leave your VM alone and you can e.g. boot/install via ISO image or PXE boot.

## What Does Ganeti Suck At?
As of the time of writing, KVM VMs are stuck with the rather old `pc` machine type and also do not support UEFI booting. This will sooner or later impose problems with Windows guest systems. There is also no official upstream GUI/web interface available (however, there are [community options](https://github.com/sipgate/gnt-cc)). The [official documentation](https://docs.ganeti.org/) works but looks a bit dated ,has a sometimes confusing structure and is missing easy-to-follow getting-started documentation (although there is work in that direction on the way). OTOH the man pages are a very good source of information. While the larger part of the codebase is written in Python (which is easy to read and understand) there are also Haskell parts, which are not that accessible to the broader public (could be rephrased to: I suck at Haskell).

## Why Should I Use Ganeti?
Ganeti is very easy to setup/bootstrap. There are packages available for Debian, Ubuntu, GNU Guix and also RPM-based distributions. Especially the official Debian packages are well maintained and you can set up an entire cluster without using any third party repositories/software. However, this procedure will be covered in a different blog post.

Upgrades of Ganeti clusters are possible and usually work flawlessly. Ganeti itself does not get in the way of your VM operations. It is very robust and can recover from many error states by itself.

While RBD/Ceph or Gluster backends require the additional installation/configuration of services outside of Ganeti, DRBD is fully managed. Ganeti will take care of all DRBD-related operations and provide you with redundant VMs at no additional operative cost.

Ganeti powers well-known infrastructures like Wikimedia, Tor Project, Debian or ICANN. It is also in use at various universities and many private companies. You can interact with developers and the community using mailing lists, IRC or Github issues.

If you are looking for a new virtualisation platform to power your business or other mission-critical environment, give Ganeti a try. You won't be disappointed!
