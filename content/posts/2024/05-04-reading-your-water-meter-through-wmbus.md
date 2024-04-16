---
title: Reading Your Water Meter Through Wireless M-Bus
description: My water meter exports data through a wireless interfaces named wireless M-Bus. Let's figure out how to obtain this data!
date: 2024-04-05
tags:
  - home automation
  - prometheus
  - wmbus
---

Recently, I stumbled across this brilliant [Mastodon thread about 50 things to do with a software defined radio (SDR)](https://chaos.social/@blinry/112036984423655020) by [@blinry](https://chaos.social/@blinry). Specifically [this Toot](https://chaos.social/@blinry/112065648093248206) about utility meters and [Wireless M-Bus](https://en.wikipedia.org/wiki/Meter-Bus) got me thinking about my own water meter. It is a rather recent model with a digital display **and** the display also shows a little RF symbol! I never put much thought into that, but seeing how it easy it might be to aquire data from the meter I thought I should give it a try.

<img src="/images/axioma-meter01.jpg" alt="" />

I am already storing data from my electricity meter in Prometheus (through an optical sensor which emits [SML data via serial interface](https://github.com/rbott/sml-reader)), as well as from my photovoltaic system (through a [modbus-over-tcp-to-mqtt-converter](https://github.com/kbialek/deye-inverter-mqtt)). I also made some very unsuccessful attempts at obtaining data from my (entirely analouge) gas meter, but that is a sad story on its own.

## RTL SDR to the rescue

Fortunately, a colleague had a RTL SDR stick with antenna to spare so I could head-start into the Wireless M-Bus world! To quote [www.rtl-sdr.com](https://www.rtl-sdr.com/) (which has lots of good resources on the topic):

> The RTL-SDR is an ultra cheap software defined radio based on DVB-T TV tuners with RTL2832U chips.

There are many different variants out there, most (if not all) are USB based. Not all of them may work equally well, some may even be counterfeits. After initial successful testing I eventually bought my own RTL SDR stick off eBay. It identifies itself as:

```
Realtek Semiconductor Corp. RTL2838 DVB-T / RTL2838UHIDIR
```

### Software Setup

I went through the exact same steps on my Thinkpad Laptop running Debian Trixie (Debian Testing at the time of this writing) and also later on my homeserver running Debian Bookworm. Let's start with some dependencies:

```shell
apt install rtl-sdr librtlsdr-dev libxml2-dev build-essential
```

Next I cloned and built [github.com/wmbusmeters/wmbusmeters](https://github.com/wmbusmeters/wmbusmeters):

```shell
git clone https://github.com/wmbusmeters/wmbusmeters.git
cd wmbusmeters
./configure
make
sudo make install
```

Followed by [github.com/weetmuts/rtl-wmbus](https://github.com/weetmuts/rtl-wmbus):
```shell
git clone https://github.com/weetmuts/rtl-wmbus.git
cd rtl-wmbus
make
make release
sudo make install
```

By default, the DVB module of your Linux kernel will 'hog' the SDR and you can not access it. To avoid that situation, you can create the following modprobe rule: 

```shell
echo 'blacklist dvb_usb_rtl28xxu' | sudo tee --append /etc/modprobe.d/blacklist-dvb_usb_rtl28xxu.conf
```

There are also sources on the internet which report that the modules `rtl2832` and `rtl2830` should also be blocked, but that did not apply to my setup.

If you already had inserted the USB stick ahead of the above command, you need to `rmmod` the DVB module (or simply reboot, if that is an option). You can verify with the following command that no DVB modules are loaded after inserting the USB stick:

```shell
lsmod|grep dvb_usb
```

### Keeping An Eye On Your Neighbors

Let's see what's going on around us:

```shell
wmbusmeters auto:c1
```

This should dump all telegrams from nearby devices. In my case, I received information from heat cost allocators (devices which count heating usage/consumption in apartment buildings to split the cost of the central heating system among all tenants):

```
Received telegram from: 55555555
          manufacturer: (TCH) Techem Service (0x5068)
                  type: Heat Cost Allocator (0x08) encrypted
                   ver: 0x6a
                device: rtlwmbus[00000001]
                  rssi: 118 dBm
                driver: unknown!
Received telegram from: 66666666
          manufacturer: (TCH) Techem Service (0x5068)
                  type: Heat Cost Allocator (0x80)
                   ver: 0x94
                device: rtlwmbus[00000001]
                  rssi: 60 dBm
                driver: fhkvdataiii
Received telegram from: 77777777
          manufacturer: (QDS) Qundis, Germany (0x4493)
                  type: Heat Cost Allocator (0x08)
                   ver: 0x35
                device: rtlwmbus[00000001]
                  rssi: 44 dBm
                driver: qcaloric
```

But - no data from any water meters. That was a bit of a bummer. I tried moving around the house, sitting right next to the water meter itself, but nothing changed. Could it be that my water meter is either not broadcasting at all or using some other means than wmbus?

On a side note: interestingly, encryption does not seem to be popular among heat cost allocators. While it surely would take some time and effort to triangulate their phyiscal location, it should be possible to create profiles of the heat usage of these apartments and thus track the presence of their tenants. As an example this would be the output of a heat cost allocator using the `fhkvdataiii` driver:

```json
{
    "media": "heat cost allocator",
    "meter": "fhkvdataiii",
    "name": "TheHeatIsOn",
    "id": "66666666",
    "current_hca": 1874,
    "previous_hca": 2651,
    "temp_radiator_c": 20.23,
    "temp_room_c": 20.08,
    "current_date": "2024-04-15T02:00:00Z",
    "previous_date": "2023-04-30T02:00:00Z",
    "timestamp": "2024-04-15T20:42:30Z",
    "device": "rtlwmbus[00000001]",
    "rssi_dbm": 21
}
```

## Getting To Know Your Water Meter

I did some digging around and found various sources of information about my water meter (which is a Axioma Qalcosonic W1):

- A webpage of a German distributor of various types of meters (with lots of information on the W1): [heitland-gmbh.de/wasser/hauswasserzaehler/W1.html](https://www.heitland-gmbh.de/wasser/hauswasserzaehler/W1.html)
- There is also the product page of the manufacturer itself: [axiomametering.com/en/products/water-metering-devices/ultrasonic/qalcosonic-w1](https://www.axiomametering.com/en/products/water-metering-devices/ultrasonic/qalcosonic-w1)
- A presentation from the above mentioned distributor to some municipal utilities company: [swd-saar.de/fileadmin/downloads/Wasser/Wasserzaehler/USZ_Qalcosonic_W1_Praesentation__1_0MB_.pdf](https://www.swd-saar.de/fileadmin/downloads/Wasser/Wasserzaehler/USZ_Qalcosonic_W1_Praesentation__1_0MB_.pdf)

The latter document prooved to be the most interesting one. Here are some key facts I have learned:

- the W1 has multiple interfaces:
  - wMBus: transmits either in T1 mode (default), in S1 mode or entirely disabled
  - LoRa WAN: disabled by default
  - NFC: read meter data on demand from cell phones / tablets (unsure if the meter can also be configured through the app)
  - IrDA: read meter data _and_ configure the meter through a Microsoft Windows software provided by the manufacturer (called *W1 Tool*)
- the presentation also contains some screenshots of the configuration software which shows some (presumably) defaults:
  - wMBus T1 enabled, S1 and LoRa WAN disabled
  - published parameters include volume and cut date/cut volume (but not e.g. temperature, flow data etc.)
  - the meter actually **only emits data Monday to Friday from 6:00 to 18:00 (every 16 seconds)** by default

Well here we go: I was doing my testing after 21:00 at night and there is a good chance that my utility company went with the default settings and hence the device stopped transmitting a while ago. Why whould someone configure a meter like that? The answer is simple: usually the folks interested in those wMBus telegrams are people who work for your utility company and want to take device readings without having to actually enter houses. They usually do not work at night and to save battery life, the meters stop transmitting after hours.

I surely would prefer the meter to transmit less often (say once a minute) but 24/7 instead - but that's just me :-) That's it for today, let's wait until the next morning.

## On To The Next Surprise

First thing in the morning: fire up the laptop and do a quick test run. Et voila, there's my meter (and also several others):

```shell
Started auto rtlwmbus[00000001] listening on c1
No meters configured. Printing id:s of all telegrams heard!
Received telegram from: 8888888
          manufacturer: (AXI) UAB Axis Industries, Lithuania (0x709)
                  type: Water meter (0x07) encrypted
                   ver: 0x10
                device: rtlwmbus[00000001]
                  rssi: 92 dBm                  
                driver: q400
Received telegram from: 9999999
          manufacturer: (AXI) UAB Axis Industries, Lithuania (0x709)
                  type: Water meter (0x07) encrypted
                   ver: 0x10
                device: rtlwmbus[00000001]
                  rssi: 24 dBm
                driver: q400
```

But what's that? The data is encrypted! On the one hand: good to know! Nobody can read my water meter and determine remotely if anybody is home or not. But on the other hand: I can not read my meter data as well :-(

I figured there's nothing to loose here so I contacted my utility company through the contact form on their web page, not expecting a meaningful response anytime soon. But lo and behold, I suddenly received a phone call after about a week. An employee of my utility company was on the line, asking for some more details from my water meter. He also told my they are not actually using wMBus for anything right now, so they do not have the (per device) decryption keys. But he might be able to enquire with the manufacturer using the details I just provided him.

Still not expecting much, I received an email with the encryption key belonging to my meter within an hour of the phone call. I identified my meter from the `wmbusmeters` run above (by its serial number) and constructed a commandline from the output:

```shell
wmbusmeters --format=json rtlwmbus[00000001] MyWaterMeter q400 9999999 ABCDEF1234567890ABCDEF1234567890
```

The order of the above parameters would be: *capture-device custom-meter-name driver serial encryption-key*. This will yield the following output (formatted for readability):

```json
{
    "media": "water",
    "meter": "q400",
    "name": "MyWaterMeter",
    "id": "9999999",
    "consumption_at_set_date_m3": 157.84,
    "total_m3": 161.963,
    "meter_datetime": "2024-04-16 06:19",
    "set_datetime": "2024-04-01 00:00",
    "status": "OK",
    "timestamp": "2024-04-16T05:19:13Z",
    "device": "rtlwmbus[00000001]",
    "rssi_dbm": 73
}
```

## How to Get The Data Into Prometheus

While there is no native support for [MQTT](https://mqtt.org/) in `wmbusmeters` itself, the documentation has some examples on how to use `mosquitto_pub` of the `mosquitto-clients` package to publish data to MQTT. In general, `wmbusmeters` supports running a shell command on each telegram and provides the entire telegram or parts of it through environment variables. The following will instruct `wmbusmeters` (via `/etc/wmbusmeters.conf`) to publish current volume, online state and RSSI to three different topics, using the meter ID as an identifier in the topic:

```shell
shell=/usr/bin/mosquitto_pub -t wmbusmeters/$METER_ID/total_m3 -m "$METER_TOTAL_M3"; /usr/bin/mosquitto_pub -t wmbusmeters/$METER_ID/status -m "$METER_STATUS"; /usr/bin/mosquitto_pub -t wmbusmeters/$METER_ID/rssi -m "$METER_RSSI_DBM"
```

You need to create a configuration for your meter as well (e.g. `/etc/wmbusmeters.d/my-meter`):

```shell
name=MyWaterMeter
driver=q400
id=0123456
key=ABCDEF1234567890ABCDEF1234567890
```

You can then enable & start the service using `systemctl`:

```shell
systemctl enable wmbusmeters
systemctl start wmbusmeters
```

It should provide log output in `/var/log/wmbusmeters/wmbusmeters.log`. You can listen to any MQTT messages using `mosquitto_sub -t 'wmbusmeters/#' -v`. Since I already receive data from my photovoltaic system using MQTT, I already have an mqtt-to-prometheus bridge in place which happily picks up the new data and stores it in prometheus.

## About That (Android) App...

I mentioned earlier that there is a mobile app to read data through NFC. And I also mentioned that it *might* be possible to see & change the configuration of the meter (e.g. make it also broadcast data over the weekend). Let's find out!

First of all, there is no iOS app. I have changed my daily driver to an iPhone a while ago so that's a bummer. The [Android app](https://play.google.com/store/apps/details?id=com.axiomametering.meter_configurator&hl=de&pli=1) can be found on the Play Store as *Meter Configurator* by *Axioma Metering*. Since I still own an Android tablet, let's try that!

Unfortunatly, I could not find the app on the Play Store using my tablet. I only then figured out that my tablet actually is not equipped with NFC. Trying to navigate to the app in the Play Store using my tablet's browser presented me the error message that the app is not supported on my device which kinda makes sense.

On to the next device, an older Android phone running Android 10. It was freshly wiped/reset, so I did a quick minimal setup/initial configuration, verified it actually *has* NFC, opened the Play Store et voila: my device is also not supported :-( Since I will be wiping the device anyways after my testing, let's try sideloading the app. First I tried [Meter Configurator](https://apkpure.com/de/meter-configurator/com.axiomametering.meter_configurator) off apkpure.com. This seems to be the most recent version (1.0.4 released January 2024), which only comes up with a login screen upon start. I do not have any credentials and it also does not give any hints against what it tries to authenticate. So this is not helpful either.

I also found an older version of the app on apkpure.com: [Qalcosonic configurator W1](https://apkpure.com/de/meter-configurator/com.axiomametering.meter_configurator) (also by Axioma), last released in 2020. I tried installing this and finally this seems to pay off. After starting the app it asks you to NFC-connect to your water meter and after doing that I was greeted with this screen:

<img src="/images/axioma-app01.png" alt="" />

This looks promising! Checking out the device configuration also yields good results:

<img src="/images/axioma-app02.png" alt="" />

From the above we can tell that LoRa WAN and WMBus T1 are enabled, while WMBus S1 is not. We can also confirm that the device only broadcasts 6-18h, Monday to Friday. It also does *not* expose flow data, device run time and temperature. I tried changing a few things, then hit the *Upload To Device*  button at the button aaaaaand:

<img src="/images/axioma-app03.png" alt="" />

Well that's too bad. I have no idea how to gain permission to write the settings back to the device (and frankly, if the manufacturer or the utility company puts effort into stopping me from fiddling with the device, they probably have a good reason to do so). Like the newer version, the app also sports a login form, but it also does not give any clues what it authenticates it against or what would happen *after* a successfull login. I could not find any documentation on the app's usage/features so we will probably never find out.