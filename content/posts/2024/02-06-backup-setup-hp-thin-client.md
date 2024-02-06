---
title: "Building a cheap and low-energy backup system"
description: After my old custom-built backup setup died, I decided to try a different route.
date: 2024-02-06
tags:
  - ansible
  - backup
  - synology
  - restic
  - rsync
  - thinclient
---

Backups are important. They already were important before the days of ransomware. I operate multiple virtual (public) Linux servers and also have a Synology NAS at home and I would like to keep backups of any valuable data these systems hold.

While there are plenty of cloud storage providers like Backblaze et al, I prefer to self-host my backup system. While I could do that at home, it would not provide the level of resilience I prefer as it would be in the same location as my home NAS system. But there are other options like your parent's place or maybe even a friends place if you a) trust them with potential access to your data and b) they have a decent internet connection and some bandwidth to spare.

In my specific case, my employer fortunatly offers to 'colocate' small devices (Raspberry Pi or other small computers) with public internet access, which is perfect as a remote backup site.

## Choosing the right hardware

What made me write this blog post? Well, my tiny little backup server died a few weeks ago. It was custom built with the following specs:

- InterTech A80S Mini-ITX chassis with external PSU
- Biostar J1800 NH3 Mainboard (Intel Celeron J1800 processor fixed onboard)
- 4GB DDR3 memory
- two tiny Noctua fans
- 64GB Intel S-ATA SSD (OS)
- 3TB 3.5" SATA Disk (Backup Data, LUKS-encrypted)

I bought the chassis and the mainboard, all other components were leftovers from the drawer. Unfortunatly, the Biostar mainboard did not perform well. Every few months it crashed, it got repeatedly stuck while trying to reboot and eventually it completely died, just a month after the end of the two year warranty period.

So here I am, in the need of a new backup system. At first I thought about replacing the mainboard. However, MiniITX boards with fixed low-power processers are currently rare and a bit pricey. So I did some more research. There are tons of webshops out there (or platforms like Ebay) which sell used enterprise hardware. Specifically tiny desktop systems (like Lenovo Thinkcentres) or even thin clients. I eventually ended up buying a HP T630 for 49€ from [ESM Computer](https://www.esm-computer.de/), a German webshop for used/refurbished hardware. It sports the follwoing specs:

- AMD G-Series GX-420GI 2.0 GHz (2 cores, 2 threads)
- 4GB of DDR4 memory (one out of two banks in use, system supports up to 32GB)
- 16GB M.2 SSD
- 1x RJ45 Realtek RTL8168h/8111h Gigabit LAN
- 2x Displayport (**no** HDMI or VGA!)
- 4x USB 2.0
- 2x USB 3.0 (one more is located inside)
- serial and PS/2 connectors
- one spare M.2 slot
- passive cooling
- external PSU
- dimensions: 21 x 6.5 x 21 cm

<img src="/images/backup-setup-003.jpg" alt="" />

<img src="/images/backup-setup-002.jpg" alt="" />

Please note that the two M.2 slots are **not** the same size, one is 2280, the other one is 2242 (while the included storage options is 2242, so there is still the 'larger' slot available for use). Also please note that **only** S-ATA SSDs are supported, no NVMe devices! You can find more information about the device on this [HP website](https://support.hp.com/de-de/document/c05350881).

<img src="/images/backup-setup-001.jpg" alt="" />

So it comes with 16GB of storage for the operating system, which is more than enough. 4GB of memory is also fine for my usecase. But what about backup storage? I ended up buying a 2TB M.2 S-ATA SSD. It seems that 2TB is the most you can get with M.2 and S-ATA. I also happended to get a good price on that so it did not really blew up the costs of the whole setup. Of course you can also use the USB 3.0 ports and connect an external SSD or spinning disk storage. Whatever works for you best.

All in all I ended up with a system that uses less power, generates less heat, does not need fans/active cooling and has lots of connectors compared to my old system! On top of that, the [AMD processer is way faster then the Intel one](https://www.cpubenchmark.net/compare/3077vs2167/AMD-Embedded-G-Series-GX-420GI-Radeon-R7E-vs-Intel-Celeron-J1800) I was using before (both objectively but also subjectively while interacting with the device).

If you are looking for a router-type device with multiple NICs: there _are_ M.2 based NICs out there on Amazon, AliExpress or Ebay but I really do not know if they are any good (or supported with Linux, OPNsense etc. at all). I have also not done any throughput tests with the system, other than observing that it easily handles a restic backup stream via SSH at ~100Mbit/s:

<img src="/images/backup-setup-004.png" alt="" />

## Software Setup

I am using Debian Bookworm as operating system. The setup is fairly trivial:

- OpenSSH server with a local `iptables` firewall rules + `fail2ban`
- LUKS-encrypted backup storage (which needs to be mounted manually after a system reboot)
- local backup user with an `rsync.conf` in its home directory to support backups from my Synlogy NAS using [Hyper Backup](https://www.synology.com/de-de/dsm/feature/hyper_backup)
- [Prometheus node exporter](https://prometheus.io/docs/guides/node-exporter/) for system monitoring
- [restic](https://restic.net/) stores available through SSH for all my other linux servers

The system only needs to be reachable via SSH from the outside. Whether you use the standard port or some other port for "security" is mostly up to you. Unfortunatly Hyper Backup does not support key authentication so we need to have password logins enabled in the OpenSSHd configuration (hence `fail2ban` to lock out unwanted password-guessers). Please keep in mind that Debian Bookworm does not ship with a syslog daemon by default. You need to manually install e.g. `rsyslog` so that your system has a `/var/log/auth.log` file (which in turn will be watched by `fail2ban`).

## No Screen, No Glory

Setting up the system was easy: creating a bootable Debian installer USB stick, following the standard setup - done. I made sure the system would boot even without a keyboard connected but I was up for a great surprise when I tried to boot it for the first time without a display attached: it beeps repeatedly, the system LED blinks red and that's it. There was no way to boot this system without a display connected :-(

Fortunatly the internet had me covered here: many people where complaining about this issue and fortunatly I even found a forum post where the person asking the question was kind enough to also [provide the solution](https://forums.servethehome.com/index.php?threads/hp-t620-plus-thin-client-loud-beep-on-boot-without-display-connected.25066/) (instead of going full [DenverCoder9](https://xkcd.com/979/)). BIOS Update to the rescue!

But wait, the HP website only offers a Windows executable file with the latest BIOS code :-( I'll spare you the details, but here is the quick guide to upgrading your HP T630 ThinClient's BIOS:

- download the latest BIOS update from [HP](https://support.hp.com/de-de/drivers/hp-t630-thin-client/10522151) - you can also download version M40 [from this blog](/files/sp149736.exe) (for archive reasons), but downloading BIOS code from a random website is generally *not* the brightest idea
- you need an *unused* USB drive (even 128MB would already do), which will be **wiped** in the process
- extract the executable file (in my case the standard Gnome Archive Manager tool worked just fine)
- you will end up with a bunch of files, but we are only interested in the `ToolLess` folder. Let's assume you have extracted that to `/tmp/ToolLess` and our USB drive is visible to the system as `/dev/sdc`:

```shell
# make sure no filesystem is mounted from the USB drive you just inserted
mount                        # <- look at the output
umount /media/yourname/blah  # <- unmount any mounted drives
# remove all existing partitions and create one single partition on your USB drive
cfdisk /dev/sdc
# create a FAT filesystem on the partition you just created
mkfs.vfat /dev/sdc1
# mount the filesystem
mount /dev/sdc1 /mnt
# create some folders, copy some files
mkdir /mnt/EFI
cp -av /tmp/ToolLess/HP /mnt/EFI/
# that's it, unmount the USB drive
umount /mnt
```

Now connect the USB drive to your ThinClient and power it up. After a few seconds, it should drop into an HP BIOS upgrade utility. You can start the BIOS upgrade from here (it will take a few minutes to complete).

In my case, this immediatly fixed the problem. The system now boots perfectly without a display connected.

## Boring system specs/details

If you are interested in getting an HP T630 system for yourself and you need more information, here are some details which might help you take a decision:

### lscpu

```
Architecture: x86_64
CPU op-mode(s): 32-bit, 64-bit
Address sizes: 48 bits physical, 48 bits virtual
Byte Order: Little Endian
CPU(s): 4
On-line CPU(s) list: 0-3
Vendor ID: AuthenticAMD
BIOS Vendor ID: AuthenticAMD
Model name: AMD Embedded G-Series GX-420GI Radeon R7E
BIOS Model name: AMD Embedded G-Series GX-420GI Radeon R7E CPU @ 2.0GHz
BIOS CPU family: 73
CPU family: 21
Model: 96
Thread(s) per core: 2
Core(s) per socket: 2
Socket(s): 1
Stepping: 1
Frequency boost: enabled
CPU(s) scaling MHz: 67%
CPU max MHz: 2000.0000
CPU min MHz: 900.0000
BogoMIPS: 3992.36
Flags: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx mmxext fxsr_opt pdpe1gb rdtscp lm constant_tsc rep_good acc_power nopl nonstop_tsc cpuid extd_apicid aperfmperf pni pclmulqdq monitor ssse3 fma cx1
6 sse4_1 sse4_2 movbe popcnt aes xsave avx f16c lahf_lm cmp_legacy svm extapic cr8_legacy abm sse4a misalignsse 3dnowprefetch osvw ibs xop skinit wdt lwp fma4 tce nodeid_msr tbm topoext perfctr_core perfctr_nb bpext ptsc mwaitx cpb hw_pstate ssbd ibpb vmmcall
fsgsbase bmi1 avx2 smep bmi2 xsaveopt arat npt lbrv svm_lock nrip_save tsc_scale vmcb_clean flushbyasid decodeassists pausefilter pfthreshold avic vgif overflow_recov
Virtualization features:
Virtualization: AMD-V
Caches (sum of all):
L1d: 128 KiB (4 instances)
L1i: 192 KiB (2 instances)
L2: 2 MiB (2 instances)
NUMA:
NUMA node(s): 1
NUMA node0 CPU(s): 0-3
Vulnerabilities:
Gather data sampling: Not affected
Itlb multihit: Not affected
L1tf: Not affected
Mds: Not affected
Meltdown: Not affected
Mmio stale data: Not affected
Retbleed: Mitigation; untrained return thunk; SMT vulnerable
Spec rstack overflow: Not affected
Spec store bypass: Mitigation; Speculative Store Bypass disabled via prctl
Spectre v1: Mitigation; usercopy/swapgs barriers and __user pointer sanitization
Spectre v2: Mitigation; Retpolines, IBPB conditional, STIBP disabled, RSB filling, PBRSB-eIBRS Not affected
Srbds: Not affected
Tsx async abort: Not affected 
```

### lspci

```
00:00.0 Host bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Processor Root Complex
00:00.2 IOMMU: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) I/O Memory Management Unit
00:01.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Wani [Radeon R5/R6/R7 Graphics] (rev 88)
00:01.1 Audio device: Advanced Micro Devices, Inc. [AMD/ATI] Kabini HDMI/DP Audio
00:02.0 Host bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Host Bridge
00:02.2 PCI bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Processor Root Port
00:03.0 Host bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Host Bridge
00:08.0 Encryption controller: Advanced Micro Devices, Inc. [AMD] Carrizo Platform Security Processor
00:09.0 Host bridge: Advanced Micro Devices, Inc. [AMD] Carrizo Audio Dummy Host Bridge
00:09.2 Audio device: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Audio Controller
00:10.0 USB controller: Advanced Micro Devices, Inc. [AMD] FCH USB XHCI Controller (rev 20)
00:11.0 SATA controller: Advanced Micro Devices, Inc. [AMD] FCH SATA Controller [AHCI mode] (rev 49)
00:12.0 USB controller: Advanced Micro Devices, Inc. [AMD] FCH USB EHCI Controller (rev 49)
00:14.0 SMBus: Advanced Micro Devices, Inc. [AMD] FCH SMBus Controller (rev 4a)
00:14.3 ISA bridge: Advanced Micro Devices, Inc. [AMD] FCH LPC Bridge (rev 11)
00:18.0 Host bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Processor Function 0
00:18.1 Host bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Processor Function 1
00:18.2 Host bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Processor Function 2
00:18.3 Host bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Processor Function 3
00:18.4 Host bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Processor Function 4
00:18.5 Host bridge: Advanced Micro Devices, Inc. [AMD] Family 15h (Models 60h-6fh) Processor Function 5
01:00.0 Ethernet controller: Realtek Semiconductor Co., Ltd. RTL8111/8168/8411 PCI Express Gigabit Ethernet Controller (rev 15) 
```

### dmesg

Due to the length of the output, this can be downlaoded as a [separate file](/files/dmesg-hp-t630.txt). Please note that the AMD virtualisation feature seem to be supported, but I have disabled that in BIOS as I do not need it on this system.