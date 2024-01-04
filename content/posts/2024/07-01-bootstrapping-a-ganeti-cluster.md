---
title: Bootstrapping a Ganeti Cluster
description: How to create and operate a Ganeti node or cluster.
date: 2024-01-07
tags:
  - ganeti
---
[Ganeti](https://ganeti.org) is a virtualisation management solution for clusters which easily scales from few to hundreds of VMs. Please also see [this blog post](https://blog.bott.im/introduction-to-ganeti/) for an introduction to Ganeti.

Today I would like to focus on the bootstrapping of a Ganeti cluster. Let's start with some assumptions about our setup, to keep this guide easy!

## Assumptions

While you *could* run Ganeti Nodes in a virtual environment we will not cover that today. Unless you are testing Ganeti itself, you will most likely run your VM environment directly on bare metal :-) This guide assumes a cluster of three hardware nodes. Unless you are going straight to production it does not matter whether you are using simple workstations or full blown rack servers. If you plan to use live migration between nodes, the CPUs should be of the exact same type (more on that below), but at least similar. At a minium they must be x86-64 architecture, support hardware virtualisation aka KVM (Intel) or SVM (AMD) and should *either* be Intel *or* AMD.

We will assume Debian Bookworm to be installed on the servers and focus on that for the remainder of this post. If you favor a rpm-based distribution, you can find packages for Ganeti in [this repository](https://jfut.integ.jp/linux/ganeti/) but you will need to adapt the rest of this guide by yourself to your distribution.

The cluster will use DRBD as storage backend to Ganeti. This allows for VM redundancy and live migration without any additional configuration. Ganeti does also offer other replicated storage backends (e.g. RBD, GlusterFS) but all of them require further configuration steps which will exceed the focus of this post.

We will also build a very simple network setup - one interface per node and all are located on the same IPv4 subnet. However, you will find a section at the end of this post on a more sophisticated design. Our three servers will be named `ganeti01.example.org` (192.0.2.5), `ganeti02.example.org` (192.0.2.6) and `ganeti03.example.org` (192.0.2.6). We also have to reserve a dedicated cluster IP on the same subnet (`ganeti-cluster01.example.org`, 192.0.2.4), which will be used and managed by Ganeti. Please make sure that all of your nodes can resolve all four hostnames to their respective IP addresses - either through DNS or through `/etc/hosts`.

## Basic Hardware Setup

Please allocate at least 60-100GB of space for your nodes root filesystems. While this is not strictly needed, it might come in handy later if you need to temporarily store a VM image on a node. If you are low on disk space, 10-15GB should also do just fine for a basic Debian server installation with Ganeti and some headroom.
The remainder of your disk space should be allocated as a physical device for LVM. Please create an empty volume group named `gnt` on each server (we assume `/dev/sda5` to be the partition assigned as physical volume in the following example):

```shell
pvcreate /dev/sda5
vgcreate gnt /dev/sda5
```

Let's assume your current network configuration in `/etc/network/interfaces` looks like this:

```
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet static
    address 192.0.2.5/24
    gateway 192.0.2.1
```

We will now transform this into a bridged setup. That will allow your VMs to access the same subnet as your nodes:

```
auto lo
iface lo inet loopback

iface br0 inet static
        address 192.0.2.5/24
        bridge_ports eth0
        bridge_stp off
        bridge_waitport 0
        bridge_fd 0
```

Please reboot the nodes to activate the new configuration. 

## Bootstrap Ganeti

Please install the following packages on **all** nodes:

```shell
apt-get install bridge-utils drbd-utils ganeti ganeti-3.0 ganeti-instance-debootstrap ganeti-os-noop qemu-system-x86
```

Once this has been finished, execute the following command on `ganeti01.example.org` to initialise our cluster:

```shell
gnt-cluster init --vg-name gnt \
    --master-netdev br0 --master-netmask 24 \
    --enabled-hypervisors kvm --enabled-disk-templates=plain,drbd \
    ganeti-cluster01.example.org
```

That's it - you have successfully initialised a Ganeti cluster! `ganeti01.example.org` is now your master node, ready to accept commands. As a first step, we will now add the other two nodes to the cluster:

```shell
gnt-node add ganeti02.example.org
gnt-node add ganeti03.example.org
```

You should now be able to see a list of all three nodes:

```shell
gnt-node list
Node                  DTotal DFree MTotal MNode MFree Pinst Sinst
ganeti01.example.org  22.0G 22.0G   5.8G  1.1G  5.3G     0     0
ganeti02.example.org  22.0G 22.0G   5.8G  1.1G  5.3G     0     0
ganeti03.example.org  22.0G 22.0G   5.8G  1.1G  5.3G     0     0
```

We will now configure a bunch of cluster settings. Let's start with the VM network parameters:
```shell
gnt-cluster modify --nic-parameters mode=bridged,link=br0
```

We also want the cluster to use `hail`, the built-in resource allocator. With that, Ganeti will place new VMs automatically on nodes with enough resources and ensure an evenly utilized cluster:
```shell
gnt-cluster modify --default-iallocator hail
```

The default DRBD settings are a tad too conservative for todays NIC speeds. Especially if you operate on 10 GbE or faster, you really need those:
```shell
gnt-cluster modify --disk-parameters drbd:disk-barriers='n',protocol='C',dynamic-resync='true',c-plan-ahead='20',c-min-rate='104857600',c-max-rate='1073741824',metavg='gnt',net-custom='--max-buffers=16000 --max-epoch-size=16000' --drbd-usermode-helper /bin/true
```

Now a bunch of Qemu/KVM default settings will follow. You can check their meaning via `man gnt-instance`:
```shell
gnt-cluster modify --hypervisor-parameters kvm:disk_aio='native',kernel_path='',disk_cache='none',migration_bandwidth=1000,migration_downtime=30,serial_console=false,vhost_net=true
```

To see the entire cluster configuration with all available knobs and settings, you can run `gnt-cluster info`. You will find them all explained in `man gnt-cluster`. I will focus on a few special knobs in the following sections.

## Special Cluster Settings

### VNC Access

Ganeti allows access to the local console of your VMs via serial console (needs support inside guest), via VNC (default) or via Spice (not covered in this post). Each VM gets allocated a dedicated TCP port which will be used for VNC (or Spice). By default, Qemu will bind this port to `127.0.0.1` on the node the instance is currently running on. You can reach these ports e.g. through SSH port forwarding / tunneling. You can also instruct Ganeti to bind to `0.0.0.0`, but **that might make your instances' local console available to the public internet** (if your nodes are reachable via public IP space). If you really know what you are doing, you may change the VNC bind IP address with this command:

```shell
gnt-cluster modify --hypervisor-parameters kvm:vnc_bind_address=0.0.0.0
```

### Choosing the correct CPU Model for Qemu

If you do not change anything, your VMs will "see" an emulated CPU of Qemu type `qemu64`. While this will strip almost all useful CPU features/flags (and recent Linux kernels might not even boot), Qemu will allow you to live-migrate between almost all types of host CPUs. You most certainly **do not** want to live with that default setting. The most sensible setting would be to pass through the host CPU model:

```shell
gnt-cluster modify --hypervisor-parameters kvm:cpu_type=host
```

However, this will break live migration **if** your servers do not share the exact same type of CPU. To work around this problem, you need to find the lowest common denominator. You can do so by querying your installed Qemu version which CPU models it knows about:

```shell
qemu-system-x86_64 -cpu help
```

The oldest CPU in your fleet needs to be configured, e.g. `CascadeLake`, `Broadwell` etc:
```shell
gnt-cluster modify --hypervisor-parameters kvm:cpu_type=Broadwell
```

## Verifying the State of Your Cluster

Now that you have configured all of the basics it is time to see if everything is alright:

```shell
gnt-cluster verify
```

This should not output any errors/warnings. It is good practice to check this command regularly (or even automatically), especially before you carry out any cluster maintenance or configuration tasks.

## Let's Create Our First Virtual Machine

In order to do that, we need to decide how to bring it to life. We have multiple options at hand:

- use an ISO image to boot the instance (probably requires VNC console access)
- use PXE to bootstrap the instance (probably requires VNC console access and additional configuration of external services)
- use the debootstrap (or any other) OS provider (requires additional configuration, will be covered in a different blog post)

For the sake of simpilicty we'll go with the first option and download the awesome GRML boot CD onto **each node**. Of course you can also download any other bootable ISO:

```shell
curl -o /root/grml.iso https://download.grml.org/grml64-full_2022.11.iso
```

You might wonder why we need the ISO on each node? Since Ganeti allows you to move VMs between nodes it will require you to place external dependencies (like a configured bootable ISO) on each node so that the VM can be created/started/migrated everywhere.

Let's create and boot our new VM:

```shell
gnt-instance add \
  -t drbd --os-type noop -B minmem=2G,maxmem=2G,vcpus=2 \
  --net 0:mac=generate --disk 0:size=5G \
  -H cdrom_image_path=/root/grml.iso \
  --no-name-check --no-ip-check test-vm
```

We will drill down on the above command to understand its parts:

- `-t drbd` - set the disk template to DRBD
- `--os-type noop` - use the `noop` OS provider so that Ganeti does not attempt to install an OS itself
- `--net […] --disk […]` - add one NIC and one disk to the instance
- `-H […]` - set hypervisor parameters, in this case instruct Qemu to use the provided ISO image
- `--no-name-check --no-ip-check` - Ganeti assumes that your instance name will be a fully qualified domain name which is resolvable to an IP adress. If that is not the case, you need to specify those two options when creating a new instance

For a full list of options, please check `man gnt-instance`. Your instance will inherit all hypervisor parameters set on the cluster level, but you can still overwrite them per instance with `-H param1=value,parame2=value`. You can run `gnt-instance info <name>` to see which values have been set on instance level or have been inherited from the cluster.

Back to our newly created instance: we now need to access the VNC console to see if our GRML ISO actually booted. First of all we need to figure out the node our instance runs on and the TCP port Ganeti assigned to it:

```shell
gnt-instance info test-vm
[…]
  Nodes:
    - primary: ganeti02.example.org
[…]
  Allocated network port: 11001
[…]
    vnc_bind_address: default (127.0.0.1)
[…]
```
This tells us: the instance `test-vm` is running on the node `ganeti02.example.org` and has its VNC port available on `127.0.0.1:11001`. If you followed the advice above to modify `vnc_bind_address` to `0.0.0.0` the output will change accordingly and you can directly point your VNC client to `ganeti02.example.org:11001`. If it is bound to localhost, you need to establish an SSH connection with a port forward first (e.g. `ssh ganeti02.example.org -L 11001:localhost:11001` and then connect to `localhost:11001` with your VNC client).

If everything worked out, you should see a freshly booted GRML Linux :-)

## Everything Is a Job

Almost everything Ganeti does is handled through a job queue: starting or creating instances, live migration, adding new nodes, verifying the cluster state etc. You can watch the job queue through `gnt-job list`, retrieve specific job information through `gnt-job show <id>` and "tail" a running job's output with `gnt-job watch <id>`.

Different types of jobs create different kind of locks (e.g. a job might lock nothing at all, a specific node or even the entire cluster). Due to this locking, jobs sometimes run in parallel or have to wait in the queue until it is their turn.

Most CLI actions submit a job to the queue and simply relay the job's output until it is finished. If you are CTRL+C'ing out of e.g. an instance creation this will not actually stop the creation of the instance. The CLI will just stop relaying the job's output while it finishes in the background.

All CLI actions that submit jobs to the queue support a `--submit` parameter which will cause them to instantly return and not follow the job's output. This comes in handy when you want to automate CLI operations (e.g. use a shell loop to start/stop/restart/migrate a bunch of instances in parallel).

## A Word on Single-Node, Two-Node and "Large" Clusters

If you want to run Ganeti on a single node, this is entirely fine. You can choose the `plain` (LVM backed) or `file` disk types and of course you will not be able to move/migrate instances anywhere. Other than that, everything stated above applies.

Two node clusters are a bit special. Ganeti has the concept of a master node which takes control over the cluster, runs the job queue etc. The latter is handled by the `ganeti-luxid` service. This service checks on startup if the majority of the reachable nodes `believe` that he indeed is the master node and refuses to start otherwise. However, with only two nodes available there is only one other node to query and that will never reach a majority. This problem is not in any case special to Ganeti - as with all clustered systems it is recommended to have an odd number of nodes and at least three.

If you however insist on running a two-node-cluster, you need to pass the command line arguments `--no-voting --yes-do-it` to `ganeti-luxid` which will disable the majority check. This could in turn of course lead to a split brain scenario where both nodes believe they are a cluster master node. You can pass the arguments to the daemon through the `/etc/default/ganeti` file.

Running larger clusters (read: 6 nodes and more) is not a problem for Ganeti itself. You might want to keep in mind that Ganeti - no matter how many nodes you add - will choose six out of all nodes as "master candidates". This greatly reduces the complexity and latency of keeping information in sync between those master candidate nodes.

If your master node breaks for whatever reason, only one of the other five master canidate nodes can take over that role. 
While Ganeti automatically chooses master candidates for you, you can still override that selection and define a different set of nodes to be master candidates.

You can even define a node (or multiple nodes) as not "vm capable", which means they will never run any VM workloads and only serve as a master (or master candidate). However, I have not yet seen a cluster which required a dedicated master node from a CPU/load perspective. And please, please do not try to run your non-vm-capable master node as an instance of that same cluster :-)

## Improved Network Setup

There are several ways to improve the network setup used above. I will dig into three options as an example.

### Dedicated Replication/Migration Interfaces

If you are using DRBD or RBD/Ceph, your instances' disk I/O speed will mostly be limited by your network speed and latency. The replication traffic will also have an effect on your node management and instance traffic, as it might clog the interface. Ganeti supports dedicated interfaces (called a "secondary network") which it will then use for DRBD replication and also for live migration traffic. With todays systems, this should be at least 10 GbE or faster. Having a secondary network in place (again, all nodes should be on the same layer 3 network), this will slightly alter your cluster creation and adding new nodes:

```shell
gnt-cluster init --secondary-ip A.B.C.D […] ganeti-cluster01.example.org

gnt-node add --secondary-ip A.B.C.D ganeti02.example.org
```

You can check `man gnt-cluster` for more information on secondary networks.

### Dedicated VM Interfaces

Now that we have separated replication traffic from Ganeti host management traffic (e.g. SSH, Ganeti communication) and instance traffic, it is time to separate those two as well. This way instances will have their dedicated interface and can not interfere with node management. To achieve this, we need one more physical interface and connect it to the same network as the existing one. The following example configuration assumes `eth0` as your main node network interface, `eth1` as secondary network and `eth2` as dedicated instance traffic interface.

```
auto lo
iface lo inet loopback

# main node network interface
iface eth0 inet static
        address 192.0.2.5/24
        gateway 192.0.2.1

# secondary network connecting all nodes
iface eth1 inet static
        address 10.0.0.5/24

# bridge connected to dedicated instance traffic interface
iface br0 inet static
        bridge_ports eth2
        bridge_stp off
        bridge_waitport 0
        bridge_fd 0
```

### I Have Multiple Vlans, What Now?

If you happen to run a slightly larger environment with multiple vlans and want to run VMs across those vlans, we need to modify the bridge configuration from the above example:

```
iface br0 inet static
        bridge_ports eth2
        bridge_vlan_aware yes
        bridge_stp off
        bridge_waitport 0
        bridge_fd 0
```

Configure your switch to a trunk port with all required vlans and the bridge will now accept and retain the vlan tags. You only need to tell Ganeti which vlan tag to use for each instance:

```shell
gnt-instance create […] --net 0:mac=generate,vlan=100 […]
```

You can also modify existing instances and switch to tagged networking:

```shell
gnt-instance modify --net 0:modify,vlan=100 <instance-name>
```

### What About Redundancy?

In a production environment, you probably would not want to use a single network switch. Combine the above with redundant network infrastructure and use linux bonding interfaces instead. If you followed all advices so far, you would end up with six connected network interfaces per node:
- two interfaces as `bond0` for host connectivity, connected to separate switches
- two interfaces as `bond1` for replication traffic (possibly connected to different network gear than `bond0` for dedicated bandwidth)
- two interfaces as `bond2` optionally with tagged vlans and connected to your bridge

# Conclusion

I hope this blog post may serve as a starting point into running your own Ganeti cluster. Many aspects have been left untouched like OS providers, Ganeti API, Open vSwitch/routed networking or a web frontend.

Check back for more content on Ganeti, I will try to add the missing bits over time :-)
