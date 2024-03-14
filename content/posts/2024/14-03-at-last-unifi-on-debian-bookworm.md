---
title: "At Last: Install and Run Unifi Controller Natively on Debian Bookworm"
description: Installing the Unifi controller software on Debian has mostly been broken since Debian Stretch.
date: 2024-03-14
tags:
  - unifi
  - debian
  - bookworm
---

Back in 2018 when I bought my first Unifi accesspoint for use at home, I set up a small Debian Stretch VM at my favourite hoster to run the Unifi Controller, nowadays known as the [Unifi Network Server/Application](https://ui.com/download/releases/network-server). Back then, it was mostly "install Debian, install MongoDB, add the Unifi Repository and install the unifi package".

Eventually my home setup expanded a bit (added a PoE switch here, another access point there) and I also added several family & friends sites into the mix with few accesspoints/switches each. The Unifi Controller along with its mobile apps is a neat way to keep everything monitored and up-to-date. So far, remotely updating switches and access points and also running unattended-upgrades on the controller VM has never failed me (but nevertheless I *do* make daily backups of the data to a remote system!).

# On Unifi Gear

I am not exactly a fan of Unifi's gateway products and I also do not recommend their wireless gear for larger installations any more but if you are in the range of a home / small business network with only a few access points, you should definitly consider Unifi along with a self hosted Unifi Controller instance.

If maximum wireless performance/the latest technology is not a key factor for you, you might even be happy with a bunch of used [UAP-AC-Pro](https://eu.store.ui.com/eu/en/collections/unifi-wifi-flagship-high-capacity/products/uap-ac-pro?variant=uap-ac-pro-eu) off eBay (as they still receive software updates from Ubiquiti).

# A Tale of MongoDB, License Changes and Outdated Dependencies

The Unifi Controller is/was a giant Java blob which (I think) even shipped with its own JRE "back in the day". It depended on MongoDB 3.x which shipped with Debian Stretch at the time. However, due to MongoDB's upstream license change, major Linux distributions stopped shipping MongoDB soon after that so [it wasn't available any more starting with Debian Buster](https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=915537). 

MongoDB *does* provide "community packages" for Debian - but the Unifi Controller **still** depends today on either MongoDB 3.6 or 4.4 which are not available for Debian 11 or 12 as community packages (as support for these old MongoDB versions has long stopped upstream).

There were many "hacky" solutions in the past which tried to work around these problems by using mix-and-match Docker containers. But either you build and update those yourself *or* you need to depend on others building and providing these containers since there were no official ones. In any case, this does neither make your setup more secure nor easier to maintain and troubleshoot.


## Say Hello to the USW-Ultra

Recently I was in the need of adding a new switch to my home setup with two requirements:

- run on PoE itself
- provide PoE to connected devices

Fortunatly there is a brand new product available that covers exactly these two usecases: the [USW-Ultra](https://eu.store.ui.com/eu/en/pro/category/all-switching/collections/pro-ultra/products/usw-ultra)! I ordered it from the Unifi store and it shipped within two days. Lucky me! 

A side node if you are into buying such gear for yourself: there are some caveats with the PoE passthrough here, depening on what your upstream switch provides:

- PoE: the USW-Ultra will power on, but **not** be able to provide any power to downstream devices
- PoE+: the USW-Ultra will power on **and** provide **up to 16W** of power to downstream devices
- PoE++: the USW-Ultra will power on **and** provide **up to 42W** of power to downstream devices

As my upstream switch is a [US-8-60W](https://eu.store.ui.com/eu/en/pro/category/switching-utility/products/us-8-60w) which provides PoE+, I have 16W of power available on the USW-Ultra which totally works for my scenario. YMMV.

So I wired up the USW-Ultra, LEDs started flashing and it showed up in my Unifi Controller for adoption - but that did not work. I also could not SSH into the device do register it manually with the controller (as it turns out, SSH is not supported on the USW-Ultra). Since the device is brand new, there is not much to find on this specific problem (at least as of the time of this writing). However, one person [ran into the same problem](https://community.ui.com/questions/USW-Ultra-Cannot-adopt/564f0260-8cf6-4026-8a9e-e3b97f079982). 

Apparently I entirely overread the important information at the very end of the "technical specification":

> **Application Requirements**
>
> **UniFi Network**     Version 8.0.28 and later

However, my trusty old Debian Stretch VM was stuck with the Unifi Controller 7.x release which I could not update any further due to Java requirements which could not be met by Debian Stretch (apparently the `unifi` package stopped shipping its own JRE at some point along the way).

## Say Hello to Early Access Release

So now I was stuck with a brand new switch which I was not able to configure and also got reminded that I really neglected my sysadmin duties by letting my Unifi Controller setup rot on an old Debian Stretch VM.

As I was venting my frustration about Unifi's MongoDB support in several Google searches, I stumbled across a hint about the latest early access release of the Unifi Controller, which apparently has some news regarding the supported MongoDB versions!

Luckily I had enlisted my Unifi account for early access releases years ago (and also entirely forgot about that until I logged in last night). Et voilà, the latest EA release of [UniFi Network Application 8.1.113](https://community.ui.com/releases/UniFi-Network-Application-8-1-113/a33c9fb4-bb37-427d-9486-59a33a693abf) has something very important hidden in the "additional information" section:

> UniFi Network Application 7.5 and newer requires MongoDB 3.6 and Java 17.
> - Version 7.5 till 8.0 supports up to MongoDB 4.4.
> - Version 8.1 and newer supports up to MongoDB 7.0.

Hooray! Finally! With MongoDB 7.x being the current stable version, there are "community packages" available for installation on Debian Bookworm!

## Quick Installation Guide of Unifi Network Application on Debian Bookworm

So I plucked up all my courage and ventured into the deep end: I created one final backup snapshot of my trusty Debian Stretch VM, logged into the Unifi controller and downloaded the latest configuration/data backup (`Settings -> System -> Backups -> Download`) and shut down the system. I then used my hoster's admin panel to recreate the VM using the latest Debian Bookworm image and loosely followed these steps:

### MongoDB

I installed the "community edition" of MongoDB following loosely [this guide](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-debian/):

```shell
apt install gnupg curl

curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc |gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor 

echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list

apt update
apt install mongodb-org

systemctl start mongod
systemctl enable mongod
```

Thats it - you should have a running MongoDB instance listening on `localhost`.

### Unifi Network Application

I downloaded the Debian package off the [EA release page](https://community.ui.com/releases/UniFi-Network-Application-8-1-113/a33c9fb4-bb37-427d-9486-59a33a693abf), uploaded it to the VM and used `apt` to install it (along with its dependencies):

```shell
apt install /root/unifi_sysvinit_all.deb

systemctl enable unifi
```

I then navigated to the webinterface (by default it starts with a self-signed certificate on port 8443) and instead of creating a new account I clicked on the "restore from backup" link at the bottom.

Importing the backup took around 5 minutes (my VM only as a single CPU core assigned) and tada: after logging in, all my sites and devices showed up **and** I was also able to adopt my brand new USW-Ultra!

If I had read the release notes a bit more thouroughly, I would have been warned:

> UniFi Network Application updates may cause your adopted devices to be re-provisioned.

The only issue with the entire update process was that all my devices dropped connections for a while when they re-registered with the new controller for the first time. Other than that, everything went flawless.

The entire process from shutting down the old VM to logging into my brand new Unifi Controller with all data restored took around 20 minutes.

I do not recommend running a fresh VM without any further configuration/hardening publicly on the internet. Luckily I have my [Ansible playbooks](https://blog.bott.im/a-decade-of-using-ansible-takeaways-and-best-practices/) at hand to quickly deal with stuff like properly configuring SSHD, fail2ban, firewalling, backup and other essential stuff. So should you!

If you are still running an old setup for your Unifi Controller, fear not - help is on the way! Either apply for early access with your Unifi account or wait for the general availibilty release of the 8.1 version.