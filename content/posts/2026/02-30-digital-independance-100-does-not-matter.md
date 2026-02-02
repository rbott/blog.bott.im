---
title: "Digital Independence: Why 100% Does Not Matter"
description: "From Paperless-ngx to Mastodon: Exploring the services I run, the ones I pay for, and why I haven't ditched my iPhone (yet)."
date: 2026-02-03
tags:
  - did
  - digital-independence-day
  - selfhosting

---

Digital independence doesn't have to be an "all or nothing" mission. During last year's [Chaos Communication Congress](https://events.ccc.de/congress/) the "[Digital Independence Day](https://di.day/)" was announced to the general public. Supported by various organisations, it tries to convince people to move away from platforms owned by Big Tech (e.g. WhatsApp, Amazon, Facebook and the like) and switch to alternatives. This addresses concerns about data privacy and sovereignty, as well as the dominance of US-based platforms. It does not necessarily mean to self-host everything on cheap virtual machines or at home. In this blog post I will try to give an overview of services I use or run by myself (and why I choose them).

Spoiler: this is not a "how I replaced every corporate piece of software/hardware with free/open alternatives" kind of blog post. I'll rather try to elaborate on things I use on a daily basis and why I choose this or that solution. This is also not a guide on how to set up a datecenter hosting 50 different applications in your basement (and frankly, don't do that!).

# E-Mail

Introducing a new e-mail address has probably become as bad (or even worse?) than switching your bank account. Today this is not only about getting your friends to update their address book: you have to update tons of online profiles / shop accounts (if you care) because...

- account recovery
- login confirmation links / 2FA mails
- service notifications
- invoices
- the list goes on...

For those reasons I decided long ago that I will use my own personal domain(s) to handle my e-mail. If you go down that route, just make sure to choose a well established TLD. By well established I mean avoid the woes of [.io](https://en.wikipedia.org/wiki/.io#Future) or [.af](https://www.reuters.com/technology/brokeaf-goes-offline-afghan-web-domains-suspended-amid-payment-dispute-2024-02-16/) TLDs and the like. Also stay away from "new gTLDs" (like ".sexy", ".wtf", ".tech"). The companies operating them might surprise you with [sharp price increases](https://rocket.domains/outrageous-tld-price-hikes-blow-small-businesses-people). Another (sad) side-effect of these "fun" TLDs: even in 2026 there are web forms out there which insist that `valid@e-mail.wtf` is *not* a valid e-mail address.

In my professional life I have operated/maintained quite a few e-mail systems so it is safe to say that I know my way around. But still, I am not self-hosting e-mail today. Why is that? I did so for several years on a virtual machine from a German hosting company. It worked well with a setup based on `exim` (SMTP), `spamassassin` (spam detection, blocklist-handling), `dovecot` (IMAP) and `roundcube` (webmail). When I booked a new virtual machine and migrated everything over, it went downhill from there. The new system had an IP address from an entirely different netblock and I had trouble submitting mails to e.g. Microsoft services (hotmail.com, outlook.com etc.). I had to register here and there, improve my "IP reputation" using various click-through websites, forms etc. For a while I even kept the old virtual machine running just as an outgoing relay host. But eventually the same problems appeared with the that ip address as well. I guess that just happens when you use a cheap virtual machine hoster and not everyone on the same /24 subnet is a good netizen.

At the same time, I had to keep up with things like SPF, DKIM and the like and then I finally caved in: no more self-hosting e-mail for me! But I would not include e-mail in *this* blog post if I moved everything to Google or Microsoft, would I? Right: I chose a different path and went with the German e-mail hosting company [mailbox.org](https://mailbox.org/en/). They operate a really stable, state-of-the art e-mail platform and in the past years I never had any trouble receiving or sending e-mails. It is also possible to "bring your own domain" (as I did) and have multiple accounts on that domain as well (friends, family, etc.). The only drawback: although they have improved, their UX (especially regarding settings, payment and the like) is not-so-state-of-the-art (let's say confusing or overwhelming at best). I also do not use any of their other services, so I can not say anything about the non e-mail stuff. The next service on my list would have been [Proton Mail](https://proton.me/mail), but since I was happy with mailbox.org from the start, I never got to check them out properly.

# (Instant) Messaging

So far, I have not been courageous enough to actually drop WhatsApp. However, I thought about moving WhatsApp to a separate phone that never leaves the house. That would mean people are still able to contact me, but it might take a day or two for me to reply. In most situations this is probably good enough *and* it keeps the app of my daily driver phone.

But what are the alternatives? I have been a long-time user of [Threema](https://threema.com/en) and also recently decided to join the [Signal](https://signal.org/) club. Both are very good options although Threema never really took off in my bubble. There were always a handful of (tech-savy) contacts using it but Signal seems to have a much broader acceptance, also with non-tech users.

In any case: moving away from WhatsApp, Facebook Messenger and the like (even if only for your most important / closest contacts) is a step in the right direction. With alternatives like Threema or Signal which have a very low entry barrier you are most likely to convince others to move there as well (or they might even already be there!).

# Social Media

I left Twitter sometime before they changed their name and never looked back. Find me on the [chaos.social Mastodon server](https://chaos.social/@rbo_ne)! Would I self-host Mastodon? No, not right now. I trust the operators of the chaos.social instance and they do a very good job (they are members of the CCC, but it is *not* an official Mastodon instance operated in the name of CCC). Looking to join Mastodon / the Fediverse? Go with the "official" [mastodon.social](https://mastodon.social/explore) instance or find one with a server operator you trust. Make sure to check if they accept/need donations to keep the server(s) up and running. It is always possible to move between servers later without losing your content/followers (see the [official documentation](https://docs.joinmastodon.org/user/moving/) on this). If you really want to be independent, [self-hosting Mastdon](https://docs.joinmastodon.org/user/run-your-own/) is possible - or choose one of the listed Mastodon hosting companies. The latter is not exactly self-hosting, but takes away the burdern of running a public internet service, especially if your are not *that* much of a tech person or if you simply do not feel like tracking and installing all (security) updates on a regular basis.

I have never looked at Bluesky or Threads and I do not intend to do so. Mastodon aka the Fediverse is all I am looking for in a (decentralised) social network and I certainly do not need more sources of distraction :-)

# Audio Streaming

I have been a Spotify user since 2014. Is that a good thing? Most certainly not. There are many reasons to not like Spotify (and if you were not aware yet, just use the search engine of your liking to find out) but out of convenience I stayed. It works flawlessly on both my Windows and Linux computers, tablets, mobile phones, in cars... you name it. And of couse there is pretty much anything on there from music over audiobooks to podcasts. Spotify specifically works well for "casual listening" (e.g. background noise). Bonuspoints for Spotify not being a US-based company.

But what if you're not into casual listening? If you prefer to listen to music the way the artist intended to? Enter [Qobuz](https://www.qobuz.com/), a French company which was known early on for offering hi-res audio streaming at an affordable price. At the same time, their interface always seemed to focus more on albums than on (auto-generated, moderated or community-sourced) playlists. There *are* playlists, but they were rather static and did not change very often. The music catalog is probably comparable to Spotify (at least it felt like that when I used both services for a while), although back then (~2018-ish) there were only few audiobooks and no podcasts at all. The latter is not a problem to me because there are specific platforms for podcasts. What drove me away from Qobuz back then were mainly four reasons:

- there is no native (well, or at least pseudo-native Electron-) app on Linux and the webplayer sometimes had (minor) issues
- there were no audiobooks (or at least not the ones I was interested in) but a quick search showed that is not true any more
- sometimes it *is* convenient to have spotify play *something* in the background without much search effort
- due to the three reasons above I saw no point in paying for two music streaming services

I found [this article by Andrew Dubber](https://andrewdubber.com/music-discovery-qobuz-vs-spotify/) which sums up the differences between both services quite well.

While researching for this article I learned that [inofficial Electron Desktop apps](https://github.com/Sophokles187/qobux/) and even a [TUI](https://github.com/SofusA/qobuz-player) are a thing now for Linux based systems. I might reconsider ditching Spotify in favour of Qobuz :-)

Of course neither Spotify nor Qobuz address the issue of "not owning things". Yes I know Qobuz also sells DRM-free hi-res audio downloads, but that's not the point of a streaming service (and of course Qobuz charges you separately per purchase). Whenever I feel like actually buying/owning music, I'll check if there is a vinyl edition available and buy that instead.

# Mobile Phone

Let's start with a confession: after using Android based phones for many years, I switched to an iPhone a few years ago. This is probably not what you expected to find in a blog post about digital independence and you are absolutely right on that one. For quite a while I was a fan of the Sony Xperia Compact series (e.g. Sony Xperia XZ1 Compact, XZ2 Compact etc.). They delivered good specs/performance in a small form factor and almost no pre-installed/non-removable third party apps. Unfortunately Sony stopped producing the compact series and with that there were no more "small" Android phones on the market which delivered a decent performance. The only options available came with very outdated processors or other drawbacks. Surprisingly, the only viable option at that time was to go with the iPhone 13 mini and that already is the story of how I ended up switching to an iPhone. Unfortunately, Apple also abandoned the idea of producing smaller versions of their phones so I guess I am out of options as soon as the iPhone 13 reaches its end of life (in terms of software support).

If you are an Android user and would like some level of privacy, check out [GrapheneOS](https://grapheneos.org/). It can be installed on many Pixel phones and comes entirely Google-free by default. You can install a [sandboxed Google Play service](https://grapheneos.org/usage#sandboxed-google-play) to run 3rd party apps that depend on it and with that you should have a pretty decent smartphone experience.

## Linux On Your Phone

Being a long-time Linux user, I have been keeping an eye on the situation of Linux phones in the last years. Be it the [PinePhone](https://pine64.org/devices/pinephone/), the [Librem 5](https://puri.sm/products/librem-5/) or devices running [postmarketOS](https://postmarketos.org/). While the first two never really convinced me (I got to lay my hands on them every now and then at conferences) I finally gave in and tried out postmarketOS last year. I bought myself a used OnePlus 6 which was supposedly the best option at the time to run postmarketOS on. I tried the different UIs available (GNOME, Phosh and Plasma Mobile) and while I totally dig running Linux on my phone I could not really get the hang of it. No matter the flavor I installed, all felt somewhat sluggish/slow on the device. Every now and then I update the phone to the latest release to see if there are significant changes but it never left my desk, so I cannot really give much feedback on everyday use. I like the project in general and they are doing a great job trying to get Linux onto mobile phones. It is really worth checking out even just to be in the loop about the latest developments!

# Specific Applications

Let's dig into some specific applications I use every day!

## Notes

After using Google Notes (or rather: Google Keep) for many years of casual note-taking (on the desktop, smartphone and tablet), I eventually lost overview in the app. Time for something new, better and ideally self-hosted! Bonuspoints for having a good shopping list feature (spoiler: that did not happen). I looked at various apps/systems like [Joplin](https://joplinapp.org/), [Obsidian](https://obsidian.md/) or [Logseq](https://logseq.com/). In the end I went with something entirely else: [Standard Notes](https://standardnotes.com/).

Standard Notes has been acquired by Proton (yes, the company behind Proton Mail) in 2024 and is available as a hosted (paid) solution but also for self-hosting. For 39€/year (as of now) you can upgrade your local installation to the features of the ["professional" plan](https://standardnotes.com/plans) - of course minus the cloud-hosting-related features/options. I have since then used it extensively both mobile and from the desktop and I am more than happy with it.

The only drawback I found within several months of using it: the check-box feature for notes is neat, but it is absolutely no good for shopping lists. I ended up using [pon](https://www.ponlist.de/) (sorry, German only) for that and it works flawlessly (especially sharing with other members of the household works like a charm).

## Searchable Document Archive

Nowadays it seems there is no way around [Paperless-ngx](https://docs.paperless-ngx.com/) if you want to organize your documents. The history of the project is somewhat confusing (with paperless-ngx being the successor of the abandoned paperless-ng which is in turn the successor of the abandoned paperless project). Nevertheless `paperless-ngx` seems to be active and healthy and it works like charm. I supply documents through a Samba share or via e-mail (Unfortunately my scanner does support neither option directly and I have to manually scan using a Windows software but that is a different story) and I feed each and every letter/invoice/information I receive as a PDF document or via snail mail into `paperless-ngx`.

I use both the web frontend and the [Swift Paperless](https://apps.apple.com/de/app/swift-paperless/id6448698521) iOS app (there are others as well, but I have not tested them) to interact with `paperless-ngx` and the service itself runs on a small hardware at home (AMD GX-420GI CPU). Due to the limited hardware it takes 30-40 seconds to process the average one-or-two pages PDF document, but that is entirely acceptable to me.

I decided to self-host at home because a) the hardware was already there and b) it just feels better to have (personal) documents stored at home (with an encrypted offsite backup).

## Local Storage

Several years ago I decided to stop building my own home storage server. Sure, it is easy to throw together some hardware, configure software RAID and install Linux & Samba. Back then I decided to go with a Synoloy NAS and *that* really was a game changer. You get a ton of features without extra payments:

- Android/iOS apps for remote file access *and* photo backup (*look Ma, no iCloud!*)
- easy Backup of data stored on the NAS to various destinations using the built-in [Hyper-Backup](https://www.synology.com/de-de/dsm/feature/hyper_backup) software, see also [this blog post](https://blog.bott.im/building-a-cheap-and-low-energy-backup-system/) on how to set up an offsite backup system for your Synology NAS
- security updates (I am rather surprised that I still receive security updates for my already dated DS218 model!)
- easy integration of e.g. UPS devices

Would I buy Synology again today? I am not 100% sure. They lost a fair amount of their good reputation with recent announcements of only supporting their own branded disks in certain NAS series (only to then backpedal on that a few weeks later).

Of course there is still a middle way between entirely building such a setup on your own and buying off-the-shelf solutions: Install [TrueNAS Community Edition](https://www.truenas.com/truenas-community-edition/), [OpenMediaVault](https://www.openmediavault.org/) or [unraid](https://unraid.net/) (paid) on custom hardware. I have never tested either of those so I can not really say anything about them. However, none of these options come with an entire ecosystem of mobile apps, backup agent software for Windows/macOS/Linux and so on. 

In the end it depends vastly on the features and usability you require/expect. It is all about making an informed decision :-)

## Home Automation

After years of using [homegear](https://homegear.eu/) to manage my Homematic Legacy (**not** Homematic IP) environment with some handmade PHP scripts / web frontends I finally switched over to [Home Assistant](https://www.home-assistant.io/) (with `homegear` as its backend for Homematic). Switching to HA also allowed me to easily include other aspects of my home (e.g. [Logitech Harmony Hub](https://www.home-assistant.io/integrations/harmony/) or [Bluesound Hi-Fi Devices](https://www.home-assistant.io/integrations/bluesound/)). The [MQTT bridge](https://www.home-assistant.io/integrations/mqtt/) made it easy to obtain data from and manage [my water meter](https://blog.bott.im/reading-your-water-meter-through-wireless-m-bus/), my photovoltaic system and power meter, my [heating system](https://blog.bott.im/exporting-ems-esp-data-to-prometheus-and-grafana/) and [Tasmota devices](https://www.home-assistant.io/integrations/tasmota/).

If you want to automate or visualise any aspects of your (smart) home, Home Asisstant is the way to go. For basic functionality it does not need powerful hardware to run and is easy to set up and update. Just make sure that you can always unlock your frontdoor or control your room temperature / lights *without* Home Assistant because at some point your little self-hosted system *will* break for whatever reason and it might take you a while to get it back online.

## Passwords

After using [pass](https://www.passwordstore.org/) for a short while a switched to [gopass](https://www.gopass.pw/) with a private Gitlab repository as backing store several years ago. Since `gopass` is `pass` compatible, any mobile app for `pass` works. I used [Password Store](https://play.google.com/store/apps/details?id=dev.msfjarvis.aps) for Android back when I still had an Android phone - I cannot really say anything about the current state of the app. On iPhone I am happy with [Pass - Password Store](https://apps.apple.com/de/app/pass-password-store/id1205820573), although the search function sometimes is a bit quirky.

Granted, the whole `pass` ecosystem (GPG, Git, SSH keys...) is not very user-friendly. If I were to start over right now, I would look at [vaultwarden](https://github.com/dani-garcia/vaultwarden), but I have no practical experience yet so I cannot really recommend nor advise against it.

# Room for Improvement

There is always room for improvement, in my case:

- Calendar & Contacts - I am still stuck with Google Calendar/Contacts, even on my iPhone
- Github - something something [Forgejo](https://forgejo.org/) (self-hosted) or [Codeberg](https://codeberg.org/), [OpenCommit](https://opencommit.eu/) (hosted)
- Office software - I already use LibreOffice locally every now and then, but often fall back to Google Docs/Sheets for convenience

# The Path to Sovereignty: Don't Aim For 100%

Total independence from Big Tech is arguably a noble goal - but don't try to go "the full mile" right away. Every step towards that goal is a win. Do yourself a favor and don't turn self-hosting everything into a full-time job; most of us already have one of those. It is okay to lean into the convenience of a Google calendar or a polished iPhone, as long as you keep an eye out on the implications.

Digital independence is about reducing dependencies and making conscious choices:

- **Ownership**: owning your domain name is more important than where your mail or your Mastodon server sits today
- **Portability**: using open standards (SMTP, IMAP, MQTT or - hell, I didn't even mention that until now - Matrix) ensures you stay "mobile" in case things go south
- **Privacy**: moving even parts of your (digital) life into encrypted and/or private solutions greatly reduces your digital footprint

Do you (dis)agree with me? Did I miss an important part? Let me know on [Mastodon](https://chaos.social/@rbo_ne)! :-)
