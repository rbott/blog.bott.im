---
title: "Micro VMs with QEMU: Millisecond Boots, Smaller Attack Surface"
description: "A stripped-down QEMU machine type that boots Linux in under 90ms - how to build one and why fast boots are not even the best selling point."
date: 2026-08-20
tags:
  - ganeti
  - linux
  - microvm
  - qemu
  - firecracker
  - kvm
  - security
  - debian
---

A recent [episode of the (German) "Engineering Kiosk" Podcast](https://engineeringkiosk.dev/podcast/episode/280-container-microvms-mit-docker-co-founder-sebastien-pahl/) with Sébastien Pahl about micro VMs reminded me that I played around with that technology a while ago and always wanted to blog about it - but never got round to it. So here we go! Being one of the maintainers of the [Ganeti project](https://www.ganeti.org) I am naturally interested in all things virtualisation & hypervisors. A few years ago [Firecracker](https://firecracker-microvm.github.io/) caught my attention and while digging deeper I found out that QEMU has [something similar](https://www.qemu.org/docs/master/system/i386/microvm.html), inspired by Firecracker. Spoiler: it never made it into Ganeti for various reasons, but a fun technology to play with nonetheless!

For the impatient: you can skip right [down to the technical section](#preparations).

# Linux Virtualisation Recap

Virtualisation is not exactly new: IBM mainframes ran VMs under [VM/370](https://en.wikipedia.org/wiki/VM_(operating_system)) in the early seventies, followed by [LPARs (logical partitions)](https://en.wikipedia.org/wiki/Logical_partition) in the late eighties. [VMware](https://en.wikipedia.org/wiki/VMware) brought it to x86 in the late 90s. The real game changer for x86 virtualisation was when Intel and AMD began shipping hardware virtualisation support (VT-x and SVM) around 2005/2006. That formed the base for the [Linux Kernel-based Virtual Machine (KVM)](https://en.wikipedia.org/wiki/Kernel-based_Virtual_Machine) and also for VirtIO (paravirtualised device drivers). Everything we touch today builds on those two.

# But What About Containers?

Containers are the other half of the story and they are not virtualisation at all: Linux [namespaces](https://en.wikipedia.org/wiki/Linux_namespaces) (a process gets its own view of networking, PIDs, users, mounts...) plus [cgroups](https://en.wikipedia.org/wiki/Cgroups) (limits on the CPU, memory and I/O it may use). If you are a German speaking person I can highly recommend [this talk by Helmut Grohne from the Chemnitzer Linux Tage 2026](https://media.ccc.de/v/clt26-255-linux-namespaces) as a great introduction/overview to the available namespace types. You may also want to check out my blog post on [automating firewall testing on Linux](https://blog.bott.im/automating-firewall-testing-on-linux/) for an interesting usecase of network namespaces.

cgroups come with one consequence that we'll meet again further down this post: a memory limit is only a *limit*, not an allocation. A process capped at 4GB still *sees* all of the host's memory - it just gets OOM-killed when it crosses the line. Applications and language runtimes have to be cgroup-aware for this to work (which, of course, most if not all are in 2026).

[LXC](https://en.wikipedia.org/wiki/LXC) has been doing this since 2008 (namespaces themselves had been landing in the kernel since 2002), but containers as a technology only took off when [Docker](https://en.wikipedia.org/wiki/Docker_(software)) arrived in 2013. The difference between LXC and Docker? Docker made containers *portable* and their image format and distribution stack was later standardised by the [OCI (Open Container Initiative)](https://en.wikipedia.org/wiki/Open_Container_Initiative). We'll come back to that too, because an OCI image turns out to be a perfectly good starting point for a micro VM.

So: containers share the host kernel and are somewhere in between `chroot` on steroids and BSD jails. Lightweight, fast to start because there is nothing to *boot*. Kernel and hardware are already initialised and up; starting a container only means creating namespaces and cgroups, setting up the network and handing control over to the entrypoint. However, you should turn to virtualisation when you need to:

- run a different operating system (even a different older/newer Linux version)
- require strong separation
- maintain portability & a stable environment (e.g. run the same VM on different hosts while the guest sees the exact same virtual hardware)
- live migrate VMs between hosts
- emulate specific hardware

The trade-off here is: a VM actually has to boot. We'll now dig into what that means.

# QEMU Full Virtualisation

QEMU supports two modes of booting a virtual machine - we'll start with so-called *full virtualisation*. Upon start, QEMU will load [SeaBIOS](https://en.wikipedia.org/wiki/SeaBIOS) (or use OVMF, the Open Virtual Machine Firmware if you are in UEFI-land) which enumerates / initialises the virtual hardware, just as a real computer would do. It will then proceed to boot from the configured device (e.g. look for a master boot record / EFI partition on the first disk, trigger a PXE boot from one of the virtual NICs etc.) and hand control over to a boot loader, followed by the operating system. You can use this mode to install and run pretty much any operating system that runs on x86 hardware inside your virtual machine.

However: the whole process is (especially compared to a container) painfully slow. Even if it's just virtual hardware the whole initialisation process takes a few seconds to complete. From virtual BIOS, past GRUB and into booting a current Linux distribution you end up somewhere between 10 and 15 seconds.

# QEMU Direct Kernel Boot

What if I told you, you can skip all of the boring virtual hardware parts above and have QEMU directly load a Linux kernel image! If you provide QEMU with a path to a kernel image, optionally an initramfs and also a kernel command line, you can skip the entire BIOS/GRUB part and shave off several seconds.

In general: Boots fast, less attack surface: win-win! But it *does* come with some operational downsides: your VM's userland does not have a kernel package installed. Instead, the kernel resides outside of the VM on the host and must be kept up-to-date independently of the virtual machine. Whatever your userland is (Debian, Arch, Fedora etc.) - it might even depend on certain kernel features to be present and sooner or later you end up maintaining a bunch of kernel builds (that sounds rather 2005-ish, doesn't it?). With full virtualisation, you can run different versions of e.g. Debian Linux and each VM has its own kernel package and is able to update and boot into that kernel independently.

If your goal is to provide a generic virtualisation platform for any kind of virtual workloads, you are probably better off with full virtualisation. However, if your VMs are much closer to containers (e.g. run very stripped down environments to host a single or very few applications), you might be better off with direct kernel boot and a customised userspace. If you are a user of [Ganeti](https://www.ganeti.org) you will be glad to hear it supports both :-)

# What's Left To Gain With Micro VMs?

So we've learned that we can greatly speed up virtual machine boot times by using direct kernel boot (and of course by tuning kernel + userland). But what if that is not enough? Granted, this is a problem which will not affect *that* many people. If you need sub-second boot times, you won't get there with regular QEMU. It still does emulate a full-blown x86 computer. Depending on the machine type chosen the kernel has to enumerate PCI/PCIe, ISA and USB buses and their peripherals, initialise graphics output, a keyboard, a terminal and so on.

If you somehow ended up in a position where your environment requires lots of (auto) scaling of services or offers lambda-function-like services, you **will** end up caring about virtual machine boot times. Especially the latter seems to have prompted Amazon/AWS to build and release [Firecracker](https://firecracker-microvm.github.io/) in 2018. It is the userland part of a hypervisor built around KVM that specifically addresses the boot-time part by creating a minimal virtual environment. That in turn prompted QEMU to release [a new machine type called "microvm"](https://www.qemu.org/docs/master/system/i386/microvm.html) in 2019 which specifically states:

> microvm is a machine type inspired by Firecracker and constructed after its machine model

## How Did QEMU Implement Micro VMs?

QEMU comes with the concept of machine types. You can enumerate the supported machine types on your installation with this command (output shortened):

```
$ qemu-system-x86_64 -machine ?
Supported machines are:
microvm              microvm (i386)
[...]
pc                   Standard PC (i440FX + PIIX, 1996) (alias of pc-i440fx-11.0)
pc-i440fx-11.0       Standard PC (i440FX + PIIX, 1996) (default)
[...]
q35                  Standard PC (Q35 + ICH9, 2009) (alias of pc-q35-11.0)
pc-q35-11.0          Standard PC (Q35 + ICH9, 2009)
isapc                ISA-only PC
nitro                Nitro Enclave
none                 empty machine
x-remote             Experimental remote machine
```

The machine type sets the baseline of devices / buses the virtual guest sees. The default of `pc` emulates an [Intel i440FX](https://en.wikipedia.org/wiki/Intel_440FX) chipset dating back to 1996. It always comes with an ISA and a PCI bus and supports e.g. USB by placing a USB host controller on the PCI bus. The newer counterpart is `q35` which emulates the Q35 chipset from the Intel Core2 era (~2007), replacing PCI with a PCIe bus. VirtIO devices support both PCI and PCIe and you will not see dramatic improvements in terms of speed / throughput when switching from `pc` to `q35`. While the emulated hardware seems very old, its age does not impose any throughput limitations.

`microvm` fits in here nicely because the easiest way to trim down features is to cut down on the virtual hardware baseline. Let's see how `microvm` and `pc`/`q35` differ:

- No PCI, PCIe or USB buses (or so we assumed, more on that below).
- No graphics card support (neither guest-facing devices nor user/operator-facing output options), only serial connectivity. That also means there is no VNC or SPICE connectivity available.
- Since there is no PCI or PCIe bus, a limited number of VirtIO devices is available through the `virtio-mmio` "bus".
- Serial console either via emulated ISA bus device or through `virtio-serial-device`.
- Network through `virtio-net-device`.
- Full virtualisation aka BIOS boot is supported in theory, but currently no BIOS implementation supports `virtio-mmio`, so VirtIO storage devices are not visible (but it would also defeat the purpose of fast booting).
- No live migration between hosts.
- No hot-add/-removal of devices (sort of a given when there's no PCI or PCIe bus :-) ).

If you are interested in the specific list of devices QEMU can offer/emulate to guests, you can list them with `qemu-system-x86_64[-microvm] -device ?`.

## Poor State Of Documentation

Unfortunately the state of the documentation is pretty poor. To figure out what is supported and what is not, my main sources of information were:

- Very very sparse QEMU documentation.
- Discussions / patches on QEMU mailing lists.
- Personal blogs of QEMU maintainers/contributors.
- QEMU source code.
- Trial & error.

Some of the statements outright contradict each other and it is very important to check the dates associated with the bits and pieces of information you find.

Want an example? As of now, the [official documentation](https://www.qemu.org/docs/master/system/i386/microvm.html) states

> It's a minimalist machine type without PCI nor ACPI support [...]

However, if you query the `microvm` machine parameters on QEMU 11 you will be surprised to see the following:

```shell
$ qemu-system-x86_64 -M microvm,? | grep -E "(acpi|pci)"
  acpi=<OnOffAuto>       - Enable ACPI
  pcie=<OnOffAuto>       - Enable PCIe
```

Just to be clear: I am not blaming the QEMU project here. Up-to-date documentation in open source projects is hard. This merely tells me that `microvm` is not a widely used technology (at least it is not widely used by people who are not familiar with QEMU anyways).

Regarding PCIe and ACPI support: neither is actually relevant to this post. We'll stay in the pure spirit of `microvm` and run things without them :-)

## Preparations

To get started with our first micro VM we need to take care of a few things:

- make sure we have a system that supports KVM / hardware virtualisation
- install QEMU
- obtain (or build) a micro VM optimised Linux kernel
- obtain (or build) a root filesystem
- set up network

A note on *where* to run all this: If you have a spare lab machine with KVM support (see next section), that's great! As long as you have `root` access via SSH you are ready to go. In my case I set up a virtual machine with Debian on my regular (Debian) workstation. In case you are wondering: so called nested KVM allows to run hardware backed virtualisation even inside virtual machines and it is enabled by default.

Disclaimer: Since I am working on throw-away virtual machine, all of my copy/paste commands below are executed as `root` and I store stuff in `/root`. I would neither do this directly on my workstation nor on a production system. You to be clear on that.

### KVM Support

I think it is safe to say that virtually all Intel and AMD based x86 CPUs support hardware virtualisation since the late 2000s (a few low-end Atom/Celeron/Pentium models being the notable exception). You can check on the running system using `lscpu`:

```shell
# lscpu
Architecture:                x86_64
  CPU op-mode(s):            32-bit, 64-bit
  Address sizes:             46 bits physical, 48 bits virtual
  Byte Order:                Little Endian
[...]
Virtualization features:
  Virtualization:            VT-x
[...]
```

The above example is taken from an Intel CPU - on AMD you would see `AMD-V` instead of `VT-x`. If no virtualisation support is listed, it might be disabled in your BIOS and you need to check there first. Your Linux system must also support the `kvm` kernel module but it will be autoloaded as soon as you start QEMU, you do not need to load that manually or configure it in `/etc/modules`.

### Install QEMU

If you are on Debian or Ubuntu based systems, all you need to do is:

```shell
apt install qemu-system-x86 qemu-system-common qemu-utils socat
```

The packages should be similarly named on other distributions.

### Micro VM Kernel

I have tried booting micro VMs both with my distribution's kernel image (Debian) and also with Alpine kernel builds (the regular one and the `-virt` variant). However, all of them have several required VirtIO drivers built as modules and that means we also need to create an initramfs which contains these modules (which makes things _way_ more complicated than they need to be). Eventually I resorted to building my own kernel which also greatly improved boot durations. Without any PCI, ACPI or USB subsystems, no drivers (except VirtIO), no filesystems (except `ext4`) etc. the kernel booted within ~150ms instead of 1.5s! Although I have not been building kernel images since the dark ages of `tar.gz`, I was kinda surprised that the overall process did not change:

```shell
apt install build-essential libncurses-dev libelf-dev flex bison bc
cd /usr/src
wget https://cdn.kernel.org/pub/linux/kernel/v7.x/linux-7.2.tar.xz  # or whatever the current version is
tar xfJ linux-7.2.tar.xz
cd linux-7.2/
make menuconfig
```

Instead of going through `menuconfig` all by yourself, you can download [my config here](https://gist.github.com/rbott/2133de41c5750f1e92cca2bfd15973d1) and store that as `.config` in your kernel directory. Then run `make olddefconfig` to update the configuration you just downloaded (which is based on Linux 7.2) to the kernel version *you* are building right now. You can still navigate the configuration afterwards with `make menuconfig` and interactively inspect/change settings.

If you *do* want to have that retro feeling of going through the entire Linux kernel configuration all by yourself, here's a brief list of subsystems/features I have disabled on my build:

- Loadable module support
- PCI, PCIe, ACPI, Power Management, I2C, one-Wire stuff
- Pretty much all device drivers except VirtIO
- Everything network-related except basic IPv4/IPv6 networking
- Everything CPU related except for AMD/Intel based systems
- In general: all settings that are documented with "If unsure, say No", unless they are KVM/virt-related :-)

As soon as you're ready: run `make` and wait a bit. Copy the resulting image somewhere more convenient:

```shell
cp arch/x86/boot/bzImage /root/custom-7.2-kernel
```

### Root Filesystem

We now have a Kernel image but we still need a root filesystem. The easiest way is to use the Alpine mini root filesystem from the [official Alpine downloads page](https://alpinelinux.org/downloads/) in the `x86_64` flavor. We'll unpack the file, add a tiny little `init` script and create an ext4 filesystem image based on that folder:

```shell
# adapt the version number to whatever you have downloaded
mkdir /root/alpine-rootfs
tar xfz alpine-minirootfs-3.24.1-x86_64.tar.gz -C /root/alpine-rootfs

# create a very simple init helper script
cat > /root/alpine-rootfs/init << 'EOF'
#!/bin/sh
mount -t proc none /proc
mount -t sysfs none /sys
mount -t devtmpfs none /dev 2>/dev/null || true
ip link set up dev eth0
udhcpc -q
exec /bin/sh
EOF
chmod +x /root/alpine-rootfs/init

# create an ext4 filesystem image with 256MB in size and copy everything from /root/alpine-rootfs folder
mkfs.ext4 -F -d /root/alpine-rootfs -L root /root/alpine-3.24-root-image 256M
```

If you want to try the setup without network access, remove the two `ip link...udhcpc -q` lines from the `init` script.

### Set Up Network

If you want to provide your micro VMs with network access, you need some preparations on the host side. QEMU has several networking options and I went with the "bridge + tap device" variant. What that means: on my host there is a network bridge with the public-facing interface of the host attached to it. For each micro VM, QEMU will create a `tap` interface on the host and attach it to the bridge. If there is a DHCP service on the local network, it will serve addresses to the micro VMs as well and we can simply use a DHCP client inside the micro VMs (see above, `udhcpc`).

```

 [ Local Network ] --- [eth0] --- [br0] -- tap0 (microVM0)
                                    |
                                    \----- tap1 (microVM1)

```

How to configure that? My regular (Debian) network configuration looked like this:

```
# The loopback network interface
auto lo
iface lo inet loopback

# The primary network interface
allow-hotplug eth0
iface eth0 inet dhcp
```

I changed this to:

```
# The loopback network interface
auto lo
iface lo inet loopback

# The primary network interface
allow-hotplug eth0
iface eth0 inet manual

auto br0
iface br0 inet dhcp
        bridge_ports eth0
        bridge_stp off
        bridge_fd 0
```

...and rebooted the system to activate the new configuration.

To ease the `tap` interface handling a bit, we will use QEMU's `qemu-bridge-helper` binary which will take care of creating/removing `tap` interface and assigning them to the bridge. For that to work we must allow our bridge `br0` in `/etc/qemu/bridge.conf`:

```
allow br0
```

## Hands-On: How To Start Your First Micro VM

Now that we have our environment all set up, let's start up our first micro VM:

```shell
/usr/bin/qemu-system-x86_64-microvm \
  -accel kvm \
  -nodefaults -no-user-config -nographic \
  -machine microvm,x-option-roms=off,pit=off,pic=off,rtc=off,acpi=off,isa-serial=off \
  -cpu host \
  -m 1024 \
  -smp 2 \
  -device virtio-serial-device \
  -device virtconsole,chardev=char0,name=console0 \
  -chardev socket,path=/var/run/test-vm01.serial,server=on,wait=off,id=char0 \
  -netdev bridge,br=br0,id=net0 \
  -device virtio-net-device,netdev=net0,mac=52:54:00:12:34:56 \
  -blockdev driver=raw,node-name=disk0,file.driver=file,file.filename=/root/alpine-3.24-root-image \
  -device virtio-blk-device,id=disk0,drive=disk0 \
  -kernel /root/custom-7.2-kernel \
  -append "earlyprintk=hvc0 console=hvc0 init=/init root=/dev/vda rw"
```

If everything works fine, you'll see...nothing. QEMU runs in foreground and that's it. Before I'll go into details, let's break this command line into smaller parts:

```shell
/usr/bin/qemu-system-x86_64-microvm \
  -accel kvm \
  -nodefaults -no-user-config -nographic \
```

We'll invoke the `microvm` build of `qemu-system-x86_64`, enable KVM acceleration, disable all parameter defaults and also any graphics output (as there is none supported on `microvm` anyways).

```shell
  -machine microvm,x-option-roms=off,pit=off,pic=off,rtc=off,acpi=off,isa-serial=off \
```

We'll set the machine type `microvm` and various related parameters:

- `x-option-roms=off`: skip any option ROMs (e.g. a NIC's PXE boot ROM)
- `pit`, `pic`, `rtc=off`: disable a bunch of timing/interrupt related legacy devices which are not needed in this environment
- `isa-serial=off`: we'll be using a virtio based serial console, so we do not need the legacy ISA device emulated
- `acpi=off`: disable ACPI. ACPI is what would normally provide device enumeration, power management and hotplug support - none of which we need in a `microvm`. Its absence is also the reason QEMU has to inject the `virtio_mmio.device=` arguments we'll look at further down

```shell
  -cpu host \
  -m 1024 \
  -smp 2 \
```

We'll pass through the original host CPU (no emulated model), configure 1024 Megabytes of memory and 2 vCPUs.

```shell
  -device virtio-serial-device \
  -device virtconsole,chardev=char0,name=console0 \
  -chardev socket,path=/var/run/test-vm01.serial,server=on,wait=off,id=char0 \
```

Since we have disabled the legacy ISA-based UART/serial console, we'll configure a VirtIO-based serial port. It will be exposed to the host through the socket `/var/run/test-vm01.serial` and we'll learn in a second how to connect to that with `socat` to interact with the virtual machine. Side Note: if you intend to start multiple VMs, make sure each one has a separate socket path.

```shell
  -netdev bridge,br=br0,id=net0 \
  -device virtio-net-device,netdev=net0,mac=52:54:00:12:34:56 \
```

Create a VirtIO based network device and connect it to the bridge `br0` on the host. `-netdev bridge` actually spawns the helper `qemu-bridge-helper` mentioned above, which takes care of creating the required `tap` interface and assigning it to the host bridge. Again, if you intend to start multiple VMs, make sure they have unique MAC addresses!

```shell
  -blockdev driver=raw,node-name=disk0,file.driver=file,file.filename=/root/alpine-3.24-root-image \
  -device virtio-blk-device,id=disk0,drive=disk0 \
```

These two lines create a VirtIO block device inside the VM and connect it to a blockdevice on the host side (or rather: a file/image of a blockdevice). In our case it's the ext4 image we have created earlier. Again, if you intend to start multiple VMs, each **must** have their own image file (otherwise you will most likely corrupt the filesystem).

```shell
  -kernel /root/custom-7.2-kernel \
  -append "earlyprintk=hvc0 console=hvc0 init=/init root=/dev/vda rw"
```

We'll boot our custom kernel, but without an init ramdisk (that would be the parameter `-initrd <path>`). We also provide the kernel with the parameters as given in the `-append` line. `hvc0` is the name of the VirtIO console port, just as the regular ISA UART based serial port would be named `ttyS0`. But wait, there's more! The kernel command line will look like this, if you'll check the logs later:

```shell
earlyprintk=hvc0 console=hvc0 init=/init root=/dev/vda rw virtio_mmio.device=512@0xfeb00e00:12 virtio_mmio.device=512@0xfeb00c00:11 virtio_mmio.device=512@0xfeb00a00:10
```

Where do the additional parameters come from? The answer is simple: since we have disabled ACPI, there is no way for the kernel to enumerate available devices (e.g. VirtIO serial port, NICs, disks). Since there is also no PCI(e) bus, the devices are exposed to the VM using VirtIO-MMIO. QEMU appends the device details / address / IRQ for each VirtIO device configured automatically to the command line provided by the user. This way the in-kernel VirtIO drivers for network, storage etc. can discover/claim/initialise the devices.

With everything explained, it is now time to actually try and connect to our first micro VM:

```shell
socat -,raw,echo=0,escape=0x11 unix-connect:/var/run/test-vm01.serial
```

Press return once and you should see `/bin/sh`'s prompt:

```
~ #
```

Using `dmesg` you can see the kernel's boot messages and also measure the time it took to boot by looking at the timestamp information:

```
[    0.000000] Linux version 7.2.0 (root@microvm-dev) (gcc (Debian 14.2.0-19) 14.2.0, GNU ld (GNU Binutils for Debian) 2.44) #2 SMP PREEMPT_DYNAMIC Wed Aug 19 00:02:09 CEST
 2026
[    0.000000] Command line: earlyprintk=hvc0 console=hvc0 init=/init root=/dev/vda rw virtio_mmio.device=512@0xfeb00e00:12 virtio_mmio.device=512@0xfeb00c00:11 virtio_mmio.
device=512@0xfeb00a00:10
[    0.000000] KERNEL supported cpus:
[    0.000000]   Intel GenuineIntel
[    0.000000]   AMD AuthenticAMD
[...]
[    0.080115] EXT4-fs (vda): recovery complete
[    0.082184] EXT4-fs (vda): mounted filesystem a2303689-c1a1-4747-a56b-007f3969f1b5 r/w with ordered data mode. Quota mode: disabled.
[    0.082311] VFS: Mounted root (ext4 filesystem) on device 254:0.
[    0.082373] VFS: Pivoted into new rootfs
[    0.082765] Freeing unused kernel image (initmem) memory: 2508K
[    0.082937] Write protecting the kernel read-only data: 16384k
[    0.083134] Freeing unused kernel image (text/rodata gap) memory: 108K
[    0.083372] Freeing unused kernel image (rodata/data gap) memory: 740K
[    0.086724] x86/mm: Checked W+X mappings: passed, no W+X pages found.
[    0.086926] Run /init as init process
[    0.086973]   with arguments:
[    0.086974]     /init
[    0.086974]   with environment:
[    0.086975]     HOME=/
[    0.086975]     TERM=linux
```

87ms - that is an impressively fast boot! In comparison, the following is the boot timing of the virtual machine (`q35` machine type) that runs the micro VM experiments:

```shell
$ systemd-analyze
Startup finished in 2.134s (kernel) + 2.303s (userspace) = 4.438s
graphical.target reached after 2.303s in userspace.
```

While we cannot really compare systemd/userspace here (after all our microvm just runs a dumb fake `init` shell script), cutting the kernel boot time from 2.1s on a generic Debian kernel down to not even 100ms with `microvm` and a custom kernel is quite impressive.

## Let's Use An OCI Image

Let's do something crazy: we use a pre-existing OCI / Docker image and run that in our micro VM (assumes you have docker installed on the system):

```shell
# pull and export the nginx:alpine OCI image
docker pull nginx:alpine
docker create --name tmp-export nginx:alpine
docker export tmp-export -o nginx-rootfs.tar
docker rm tmp-export

# create an ext4 image file
truncate -s 512M nginx-vm-root.img
mkfs.ext4 -F nginx-vm-root.img

# mount that image using the loop driver, extract OCI image and create missing folders
mount -o loop nginx-vm-root.img /mnt/
tar -xf nginx-rootfs.tar -C /mnt/
mkdir -p /mnt/{proc,sys,dev,tmp,run}

# configure busybox' inittab
tee /mnt/etc/inittab > /dev/null << 'EOF'
::sysinit:/bin/mount -t proc proc /proc
::sysinit:/bin/mount -t sysfs sysfs /sys
::sysinit:/bin/mount -t devtmpfs devtmpfs /dev
::sysinit:/bin/mount -t tmpfs tmpfs /tmp
::sysinit:/bin/mount -t tmpfs tmpfs /run
::sysinit:/sbin/ip link set lo up
::sysinit:/sbin/ip link set eth0 up
::sysinit:/sbin/udhcpc -i eth0 -q -n
::respawn:/usr/sbin/nginx -g "daemon off;"
::shutdown:/usr/sbin/nginx -s quit
EOF

# unmount
umount /mnt/
```

The `inittab` we just created will instruct busybox to set up our environment, bring up the network and run `nginx` in foreground (and restart it if it crashes).

We now need to slightly alter our QEMU commandline: change `init` to `/sbin/init` and use the `nginx-vm-root.img` we just created:

```shell
/usr/bin/qemu-system-x86_64-microvm \
  -accel kvm \
  -nodefaults -no-user-config -nographic \
  -machine microvm,x-option-roms=off,pit=off,pic=off,rtc=off,acpi=off,isa-serial=off \
  -cpu host \
  -m 1024 \
  -smp 2 \
  -device virtio-serial-device \
  -device virtconsole,chardev=char0,name=console0 \
  -chardev socket,path=/var/run/test-vm01.serial,server=on,wait=off,id=char0 \
  -netdev bridge,br=br0,id=net0 \
  -device virtio-net-device,netdev=net0,mac=52:54:00:12:34:56 \
  -blockdev driver=raw,node-name=disk0,file.driver=file,file.filename=/root/nginx-vm-root.img \
  -device virtio-blk-device,id=disk0,drive=disk0 \
  -kernel /root/custom-7.2-kernel \
  -append "earlyprintk=hvc0 console=hvc0 init=/sbin/init root=/dev/vda rw"
```

Quickly connect to the serial console after starting the micro VM so that you can see the assigned IP address:

```shell
socat -,raw,echo=0,escape=0x11 unix-connect:/var/run/test-vm01.serial

[    0.089211] Run /sbin/init as init process
udhcpc: started, v1.37.0
udhcpc: broadcasting discover
udhcpc: broadcasting select for 192.168.122.78, server 192.168.122.1
udhcpc: lease of 192.168.122.78 obtained from 192.168.122.1, lease time 3600
```

Let's see if we can access curl:

```shell
$ curl http://192.168.122.78
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
[..]
```

Et voilà - we successfully converted a pre-existing OCI image into something that can be booted as a microVM! To be fair about that boot time: the 89ms is the kernel reaching `/sbin/init`, not the whole story. QEMU's own process startup comes before it, and DHCP plus nginx come after it - the same way a container's "start time" is rarely just the runtime call. But it puts a micro VM in the same order of magnitude as a container start, and that is the interesting part.

What you *do* pay for that separation is memory. A container's memory limit is a ceiling: a process that only touches 40MB only occupies 40MB, and everything it does not use stays available to the rest of the host. Our micro VM was started with `-m 1024`, and while KVM does allocate guest memory lazily, the guest kernel will happily fill that space with page cache and never hand it back on its own. That is the trade-off: you buy a separate kernel and a real hardware boundary, and you pay for it in RAM.

# The Real Win: Attack Surface

If ultra fast boot times are a niche requirement, the security angle is not. Many - or even most - of the QEMU CVEs come from guest-facing, emulated devices (see [this talk](https://gsec.hitb.org/sg2017/sessions/qemu-attack-surface-and-security-internals/) by security researchers on the topic). If you greatly reduce the number of emulated devices visible to the guest, you greatly reduce the attack surface right along with it.

Debian makes this nicely measurable, because it ships a separate, purpose-built binary for `microvm` next to the regular one:

```shell
$ qemu-system-x86_64 -device help | grep -c 'name '
465
$ qemu-system-x86_64-microvm -device help | grep -c 'name '
197
$ ldd /usr/bin/qemu-system-x86_64 | wc -l
51
$ ldd /usr/bin/qemu-system-x86_64-microvm | wc -l
14
$ ls -lh /usr/bin/qemu-system-x86_64*
-rwxr-xr-x 1 root root  30M Jul 27 09:23 /usr/bin/qemu-system-x86_64
-rwxr-xr-x 1 root root 7.5M Jul 27 09:23 /usr/bin/qemu-system-x86_64-microvm
```

Less than half the device models, roughly a quarter of the linked libraries and a quarter of the binary size. The library count matters operationally as well as security-wise: fewer linked libraries means fewer *external* CVEs can affect your QEMU processes in the first place, and it is less likely that you need to restart QEMU processes after library updates.

# Why It Did Not Land In Ganeti

As said earlier I am one of the maintainers of the Ganeti project. Being close to virtualisation technology is what brought me to micro VMs in the first place. However, as of now there seems to be not much use for micro VMs in Ganeti. Let me explain.

First of all: [ultra] fast boot times are not relevant to Ganeti users. This is simply not what the project is designed for. If you boot a virtual machine - be it through CLI or API - you'll end up with a job in Ganeti's job queue. This job will then be picked up and executed, starting with initialising storage and network, eventually handing over control to QEMU. Depending on the type of storage, this can take anywhere from 100ms to 5 seconds. Combine job control and storage overhead and you are way past any boot time improvements micro VMs could ever achieve.

The attack surface argument from the previous section *would* have been a good reason on its own - and it comes cheap, because you don't *have* to use a specialised kernel build to boot a micro VM. A default "fat" distro kernel works too, you just give up most of the boot time gains.

I did some proof-of-concept work and implemented micro VMs as a separate hypervisor backend, announced that to the mailing list and IRC but did not receive much feedback. At the same time I currently do not have many usecases for Ganeti and micro VMs myself as the Ganeti setups I run rely too much on features like live migration, VNC/SPICE consoles, hotplugging etc. - which are missing with `microvm`.

If you would like to see micro VMs in Ganeti, do not hesitate to contact me!

# Wrapping Up

Micro VMs are an interesting topic but with a somewhat niche usecase. Apart from hyperscaler-like environments they can be useful in security-constrained areas and also in local setups ([more fancy ways to lock in AI agents](https://blog.bott.im/taming-the-beast-how-to-lock-in-your-ai-agent/))! Given the fact that QEMU is readily available on many Linux distributions there is a relatively low entry barrier. Go try it out if you have not done so yet!
