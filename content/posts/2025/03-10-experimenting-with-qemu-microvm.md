---
title: Using QEMU microvm machine type
description: Create fast-booting VMs with a low footprint.
date: 2025-03-10
tags:
  - qemu
  - microvm
  - security
---

QEMU has been around quite a while now. It supports both full emulation of hardware/architectures and hardware-backed acceleration using KVM or Xen. Together with KVM it has become the defacto standard for Linux based virtualisation both on desktops (e.g. [virt-manager](https://virt-manager.org/), [libvirt](https://libvirt.org/)) and in the datacenter (e.g. [Ganeti](https://ganeti.org/), [oVirt](https://www.ovirt.org/), [Proxmox](https://www.proxmox.com/), [Incus](https://linuxcontainers.org/incus/) and of course [Openstack](https://www.openstack.org/)).

## Is QEMU Bloated?

QEMU has been around for more than 20 years by now and accumulated many features and dependencies over time. The many different usecases like full software emulation of different architectures, processors and hardware devices or high performance hardware backed virtualisation take their toll on complexity. You can most easily see this by observing the amount of libraries QEMU is linked against (QEMU 9.2 on Debian Testing):

```shell
$ lddtree /usr/bin/qemu-system-x86_64
/usr/bin/qemu-system-x86_64 (interpreter => /lib64/ld-linux-x86-64.so.2)
    libcapstone.so.5 => /lib/x86_64-linux-gnu/libcapstone.so.5
    libgnutls.so.30 => /lib/x86_64-linux-gnu/libgnutls.so.30
        libp11-kit.so.0 => /lib/x86_64-linux-gnu/libp11-kit.so.0
            libffi.so.8 => /lib/x86_64-linux-gnu/libffi.so.8
        libidn2.so.0 => /lib/x86_64-linux-gnu/libidn2.so.0
        libunistring.so.5 => /lib/x86_64-linux-gnu/libunistring.so.5
        libtasn1.so.6 => /lib/x86_64-linux-gnu/libtasn1.so.6
    libpixman-1.so.0 => /lib/x86_64-linux-gnu/libpixman-1.so.0
    libpng16.so.16 => /lib/x86_64-linux-gnu/libpng16.so.16
    libz.so.1 => /lib/x86_64-linux-gnu/libz.so.1
    libjpeg.so.62 => /lib/x86_64-linux-gnu/libjpeg.so.62
    libsasl2.so.2 => /lib/x86_64-linux-gnu/libsasl2.so.2
        libcrypto.so.3 => /lib/x86_64-linux-gnu/libcrypto.so.3
    libudev.so.1 => /lib/x86_64-linux-gnu/libudev.so.1
        libcap.so.2 => /lib/x86_64-linux-gnu/libcap.so.2
    libpmem.so.1 => /lib/x86_64-linux-gnu/libpmem.so.1
        libndctl.so.6 => /lib/x86_64-linux-gnu/libndctl.so.6
            libuuid.so.1 => /lib/x86_64-linux-gnu/libuuid.so.1
            libkmod.so.2 => /lib/x86_64-linux-gnu/libkmod.so.2
                liblzma.so.5 => /lib/x86_64-linux-gnu/liblzma.so.5
        libdaxctl.so.1 => /lib/x86_64-linux-gnu/libdaxctl.so.1
    libseccomp.so.2 => /lib/x86_64-linux-gnu/libseccomp.so.2
    libfdt.so.1 => /lib/x86_64-linux-gnu/libfdt.so.1
    libnuma.so.1 => /lib/x86_64-linux-gnu/libnuma.so.1
    libgio-2.0.so.0 => /lib/x86_64-linux-gnu/libgio-2.0.so.0
        libmount.so.1 => /lib/x86_64-linux-gnu/libmount.so.1
            libblkid.so.1 => /lib/x86_64-linux-gnu/libblkid.so.1
        libselinux.so.1 => /lib/x86_64-linux-gnu/libselinux.so.1
            libpcre2-8.so.0 => /lib/x86_64-linux-gnu/libpcre2-8.so.0
    libgobject-2.0.so.0 => /lib/x86_64-linux-gnu/libgobject-2.0.so.0
    libglib-2.0.so.0 => /lib/x86_64-linux-gnu/libglib-2.0.so.0
        libatomic.so.1 => /lib/x86_64-linux-gnu/libatomic.so.1
    librdmacm.so.1 => /lib/x86_64-linux-gnu/librdmacm.so.1
        libnl-3.so.200 => /lib/x86_64-linux-gnu/libnl-3.so.200
    libibverbs.so.1 => /lib/x86_64-linux-gnu/libibverbs.so.1
        libnl-route-3.so.200 => /lib/x86_64-linux-gnu/libnl-route-3.so.200
    libzstd.so.1 => /lib/x86_64-linux-gnu/libzstd.so.1
    libslirp.so.0 => /lib/x86_64-linux-gnu/libslirp.so.0
    libvdeplug.so.2 => /lib/x86_64-linux-gnu/libvdeplug.so.2
    libbpf.so.1 => /lib/x86_64-linux-gnu/libbpf.so.1
        libelf.so.1 => /lib/x86_64-linux-gnu/libelf.so.1
    libnettle.so.8 => /lib/x86_64-linux-gnu/libnettle.so.8
    libgmp.so.10 => /lib/x86_64-linux-gnu/libgmp.so.10
    libhogweed.so.6 => /lib/x86_64-linux-gnu/libhogweed.so.6
    libfuse3.so.3 => /lib/x86_64-linux-gnu/libfuse3.so.3
    libaio.so.1t64 => /lib/x86_64-linux-gnu/libaio.so.1t64
    liburing.so.2 => /lib/x86_64-linux-gnu/liburing.so.2
    libgmodule-2.0.so.0 => /lib/x86_64-linux-gnu/libgmodule-2.0.so.0
    libm.so.6 => /lib/x86_64-linux-gnu/libm.so.6
    libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6
```

I would not argue that QEMU is "bloated" in a negative way (as it has proven quite stable over the past years), but it does combine _a lot_ of different usecases in one single codebase. This also means that you need to install quite a lot of dependencies on your host if you _just_ want to spwan a few VMs and also increases the attack surface if you operate an environment with increased security restrictions. And last but not least, it does not make QEMU exceptionally fast in terms of initialisiation speeds.

The latter has led to the creation of other projects like [Firecracker](https://firecracker-microvm.github.io/) which aim at being a minimalist virtual machine manager with only a fraction of the features QEMU sports. They are especially well suited if containers do not provide the flexibility / isolation your environment needs, but at the same time want exceptionally fast boot times and a greatly reduced attack surface.

## microvm To The Rescue

Around 2019 QEMU introduced a new concept called `microvm`. They implemented it in two ways:

- a new machine type (`microvm`)
- a new binary (e.g. `qemu-system-x86_64-microvm`) with greatly reduced dependencies

### QEMU machine types

Let's start with a quick introduction into QEMU machine types. A machine type describes the system QEMU emulates. You can query your QEMU installation for a list of supported machine types (slight shortened):

```shell
$ qemu-system-x86_64 -M ?
Supported machines are:
microvm              microvm (i386)
pc                   Standard PC (i440FX + PIIX, 1996) (alias of pc-i440fx-9.2)
pc-i440fx-9.2        Standard PC (i440FX + PIIX, 1996) (default)
[...]
q35                  Standard PC (Q35 + ICH9, 2009) (alias of pc-q35-9.2)
pc-q35-9.2           Standard PC (Q35 + ICH9, 2009)
[...]
isapc                ISA-only PC
none                 empty machine
x-remote             Experimental remote machine
```

The most common type to date is probably `pc`, which instructs QEMU to emulate a quite dated system based on an [Intel i440FX chipset](https://en.wikipedia.org/wiki/Intel_440FX) released in 1996 with ISA, PCI and USB buses. The slightly newer machine type is based on the Intel Q35 chipset which saw its hardware release back in 2007 and adds PCIe support. While both seem a "bit" dated from todays perspective, it does not matter in terms of performance. As the implementations are pure software, they do not come with the speed limitations their hardware equivalents had. Many of the hardware devices QEMU can emulate are either ISA or PCI cards depending on their real world pendants. VirtIO are usually implemented als PCI devices, but more on that later.

You can query your QEMU installation for all supported devices by running `qemu-system-x86_64 -device ?`, and while you are at it, `qemu-system-x86_64 -cpu ?` prints all supported CPUs / CPU flags.

Now what happens if you spawn a VM with the `microvm` machine type? This will leave you with a _very_ stripped down and simple environment:

- no PCI or PCIe bus
- no USB

With that said, you will _only_ have access to a very limited set of VirtIO devices using the simple `virtio-mmio` interface:

- serial port
- block device
- network device

Other well known missing features are:

- live migration
- hotplugging/hotremoval of any sort
- remote console like VNC or spice
- emulation of "classic" NICs or disk controllers (as theese are usually ISA or PCI devices)

ACPI support has been added (although most docs and online resources still claim the opposite) and according to what I have read it is also possible to do a fully emulated boot using the regular [SeaBIOS](https://en.wikipedia.org/wiki/SeaBIOS) implementation. However, `microvm` defaults to using `qboot`, a very fast implementation which only supports direct kernel boot (which means kernel and optionally init ramdisk need to be present on the host and will be directly loaded by QEMU). If fast VM creation/startup is your goal, the latter makes absolutely sense.

In my tests (using nested virtualisation) I ended up with ~5 seconds of kernel boot time and less than a second of userland initialisation (using a very bare Ubuntu 24.04 installation). I am quite sure the kernel initialisation time could be greatly reduced if a purpose-built kernel image had been used which does not probe for all kinds of hardware which is not present anways.

### Less Dependencies

Remember the output from `lddtree` above? Let's take a look at the special `microvm` binary recent QEMU builds provide (again, taken from QEMU 9.2 on Debian Testing):

```shell
$ lddtree /usr/bin/qemu-system-x86_64-microvm 
/usr/bin/qemu-system-x86_64-microvm (interpreter => /lib64/ld-linux-x86-64.so.2)
    libpixman-1.so.0 => /lib/x86_64-linux-gnu/libpixman-1.so.0
    libz.so.1 => /lib/x86_64-linux-gnu/libz.so.1
    libseccomp.so.2 => /lib/x86_64-linux-gnu/libseccomp.so.2
    libfdt.so.1 => /lib/x86_64-linux-gnu/libfdt.so.1
    libnuma.so.1 => /lib/x86_64-linux-gnu/libnuma.so.1
    libaio.so.1t64 => /lib/x86_64-linux-gnu/libaio.so.1t64
    liburing.so.2 => /lib/x86_64-linux-gnu/liburing.so.2
    libglib-2.0.so.0 => /lib/x86_64-linux-gnu/libglib-2.0.so.0
        libatomic.so.1 => /lib/x86_64-linux-gnu/libatomic.so.1
        libpcre2-8.so.0 => /lib/x86_64-linux-gnu/libpcre2-8.so.0
    libm.so.6 => /lib/x86_64-linux-gnu/libm.so.6
    libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6
```

That's down to almost a quarter of the libraries compared to the full build!