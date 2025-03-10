---
title: Exporting EMS-ESP Data to Prometheus & Grafana
description: Getting all those fancy boiler data points into a time series DB.
date: 2025-03-10
tags:
  - ems-esp
  - home automation
  - prometheus
  - grafana
---

A while ago our landlord got our old gas heater replaced with a newer gas condensing heating system (specifically a [Bosch GC7000F](https://www.youtube.com/watch?v=v2kV6pgJxuo)). Unexpectedly it came along with a voucher for a free Bosch internet gateway (Bosch Connect-Key K 30 RF). Even more unexpectedly I received the gateway only a few weeks after registering online. However, that turned out to be sort of a bummer quite quickly. In short: this gateway has no local endpoint whatsoever and only submits data encrypted to Bosch systems. You may access the data through their HomeCom app ([iOS](https://apps.apple.com/de/app/homecom-easy/id1438634070), [Android](https://play.google.com/store/apps/details?id=com.bosch.tt.dashtt&hl=de&pli=1)) but that's about it. Their support has confirmed there are no immediate plans to changes this. Some more information can be found in [this Github issue](https://github.com/bosch-thermostat/home-assistant-bosch-custom-component/issues/335).

Being more of a technical (and also data privacy aware) person, the above solution was not very appealing. So I looked around a bit and stumbled across the great [EMS-ESP](https://emsesp.org/) project. Let's start with a quick overview about EMS:

## EMS - Energy Management System

What is EMS? It is a proprietary bus found in many European-made heating systems, namely by manufacturers like Bosch, Junkers, Nefit, Worcester and others. Of course everyone goes their own way and so there are many variants of EMS like EMS+, EMS2, EMS Plus and so on. It is used to e.g. connect a boiler and its thermostat / control unit and is both used for reading and setting values. The bus operates at 15V DC and is able to power connected smaller devices with that.

## EMS-ESP?

Fortunatly clever people reverse engineered EMS and related variants and came up with a system design based on the [ESP32 microcontrollers](https://en.wikipedia.org/wiki/ESP32). If you are a hands-on-I'll-solder-anything-to-anything-type-of-person you can get away with a cheap solution to interface with your heating system by building it yourself and flashing the [open source firmware](https://github.com/emsesp/EMS-ESP32). If you do not feel quite up to this task, you can also buy ready-to-connect boxes from the [BBQKees Electronics](https://bbqkees-electronics.nl/) online shop. They sell devices with Wi-Fi or LAN connectivity and support EMS connections through the service jack or through the internal connectors of your heating system.

EMS-ESP comes with a simple web interface and allows to publish the data via a REST API and [MQTT](https://en.wikipedia.org/wiki/MQTT) in JSON format. I am not going to deep-dive into the configuration of MQTT and EMS-ESP here because there is plenty of good documentation on this available.

As a bonus, the data published through MQTT can be directly used in [HomeAssistant](https://www.home-assistant.io/) and will provide you with all the entities you may have ever dreamed of.

Of course, you can not only read entities but also modify some of them. However, keep in mind that if there is another controller-type unit connected to your EMS bus (and there most likely is), it will immediatly override changes you make.

## But There Is No /metrics Endpoint

Right. Unfortunatly, EMS-ESP does not (yet?) support Prometheus out of the box. There are two solutions available: 

- [ems-esp-exporter](https://github.com/poelstra/ems-esp-exporter) which is written in TypeScript/Node.js and queries the REST API of your EMS-ESP device whenever metrics are requested
- [mqtt2prometheus](https://github.com/hikhvar/mqtt2prometheus) which is written in Golang and a generic MQTT exporter

Being more of a Golang and very much less of a Java/TypeScript person, I choose the latter option. Also that means I can re-use the messages already published to MQTT and do not need to annoy the EMS-ESP device with additional HTTP requests. First of all I looked at the data on the message bus (I configured EMS-ESP to use the `ems-esp` topic):

```shell
$ mosquitto_sub -v -t "ems-esp/boiler_data"

ems-esp/boiler_data {"reset":"","heatingoff":"off","heatingactive":"off","tapwateractive":"off","selflowtemp":38,"heatingpumpmod":100,"outdoortemp":6.7,"curflowtemp":39.3,"rettemp":25.2, [...]
```

The data you see will vary depending on the exact boiler model connected to your EMS-ESP.

## How Does mqtt2prometheus Work?

This software connects to a MQTT broker, listens to a specified topic and expects to receive JSON data as payload. However, it will not magically autodetect metrics from JSON data but rather each metric needs to be specified in the configuration file. Since this rather annoying work (given the sheer amount of metrics) I have created this very (very _very_) simple Python helper script which reads a textfile (`data.json`) with the above JSON blob and creates YAML output suitable for use in the `mqtt2prometheus` configuration file:

```python
#!/usr/bin/python3

import json
from yaml import dump

def main():
    with open('data.json', 'r') as file:
        data = file.read()
    json_data = json.loads(data)
    kvs = recursive_transform(json_data)
    yaml_data = []
    for kv in kvs:
        prom_data = {
            "prom_name": f"ems_esp_{kv['name']}",
            "mqtt_name": kv['name'].replace("_", "."),
            "help": f"EMS-ESP Data: {kv['name'].replace('_', ' ')}",
        }
        if kv["type"] == "number":
            if 'meter' in kv['name'] or "starts" in kv['name'] or 'time' in kv['name'] or 'nrg' in kv['name'] or 'energy' in kv['name']:
                prom_data["type"] = "counter"
            else:
                prom_data["type"] = "gauge"
        else:
            prom_data["type"] = "gauge"
            prom_data["string_value_mapping"] = {
                "map": {
                    "off": 0,
                    "on": 1
                },
                "error_value": 0,
            }
        yaml_data.append(prom_data)
    print(dump(yaml_data))

def recursive_transform(data, prefix=""):
    output = []
    for name, value in data.items():
        if prefix:
            name = f"{prefix}_{name}"
        if isinstance(value, dict):
            print(f"Found nested dict: {name}")
            output = output + recursive_transform(value, name)
            continue
        if isinstance(value, int) or isinstance(value, float):
            output.append({ "name": name, "type": "number" })
            continue
        if isinstance(value, str):
            if value in ["on", "off"]:
                output.append({ "name": name, "type": "state" })
            else:
                print(f"Unknown string k/v ({name}: {value})")
            continue
        print(f"Unknown data type for k/v ({name}: {value})")

    return output

if __name__ == "__main__":
    main()
```

It is able to detect state metrics containing `on`/`off` values and instructs `mqtt2prometheus` to map these to the numeric values `1` and `0` respectively. Also it tries to guess if the metric is of type `gauge` or `counter`. Running the script produces output like:

```yaml
- help: 'EMS-ESP Data: heatingoff'
  mqtt_name: heatingoff
  prom_name: ems_esp_heatingoff
  string_value_mapping:
    error_value: 0
    map:
      'off': 0
      'on': 1
  type: gauge
- help: 'EMS-ESP Data: heatingactive'
  mqtt_name: heatingactive
  prom_name: ems_esp_heatingactive
  string_value_mapping:
    error_value: 0
    map:
      'off': 0
      'on': 1
  type: gauge
- help: 'EMS-ESP Data: curflowtemp'
  mqtt_name: curflowtemp
  prom_name: ems_esp_curflowtemp
  type: gauge
[...]
```

You can now copy this into `/etc/mqtt2prometheus/config.yaml` (for all other settings except `metrics` check the `mqtt2prometheus` documentation and/or example config file):

```yaml
mqtt:
  server: tcp://127.0.0.1:1883
  topic_path: ems-esp/boiler_data
  qos: 0
cache:
  timeout: 24h
json_parsing:
  separator: .
metrics:
  - help: 'EMS-ESP Data: heatingoff'
    mqtt_name: heatingoff
    prom_name: ems_esp_heatingoff
    string_value_mapping:
      error_value: 0
      map:
        'off': 0
        'on': 1
    type: gauge
  - help: 'EMS-ESP Data: heatingactive'
    mqtt_name: heatingactive
    prom_name: ems_esp_heatingactive
    string_value_mapping:
      error_value: 0
      map:
        'off': 0
        'on': 1
    type: gauge
  - help: 'EMS-ESP Data: curflowtemp'
    mqtt_name: curflowtemp
    prom_name: ems_esp_curflowtemp
    type: gauge
[...]
```

After starting `mqtt2prometheus` you should not see much besides:

```
info   mqttclient/mqttClient.go:20   Connected to MQTT Broker
info   mqttclient/mqttClient.go:21   Will subscribe to topic   {"topic": "ems-esp/boiler_data"}
```

You can now check the `/metrics` route of `mqtt2prometheus` using `curl`. And point your prometheus scraper towards that new metrics endpoint, fire up Grafana and build your dashboard with the new metrics at hand.

