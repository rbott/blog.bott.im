---
title: Using Hooks to integrate Ganeti with external Tools
description: Ganeti has an extensive hook system that allows to trigger scripts on certain events.
date: 2024-02-03
tags:
  - ganeti
---

Automating Ganeti is easily possible through its [RAPI Interface](https://docs.ganeti.org/docs/ganeti/3.0/html/rapi.html). While that allows control over the cluster and its instances it is not very well suited to source events (unless you do constant polling and track state elsewhere). Luckily Ganeti features a [hook system](https://docs.ganeti.org/docs/ganeti/3.0/html/hooks.html) which allows the execution of arbitrary scripts/binaries upon events.

As the documentation is quite good, I will try to repeat as little as possible of that information here. However, I would like to introduce a few use cases which I have used/built myself or which have been discussed on mailing lists, IRC etc.

## Pre vs. Post Hooks
Ganeti knows about pre or post hooks. As the names indicate, they are executed either before or after the requested operation takes place (e.g. adding of an instance or a new node). The major difference between the two is: exit codes of pre hooks are evaluated and the following Ganeti operation will not run when exit code is non-zero! This way you can implement checks against third party systems (e.g. DCIM, authorization systems etc.) and stop the operation if required. This will result in the job being marked as failed in the Ganeti job queue.

Post hooks on the other hand will be executed after the Ganeti operation has finished and not checked for their exit code at all. Depending on what you are trying to achieve, choose either option and keep the implications in mind.

## What Language Should I Write the Hook Scripts In?
That is entirely up to you. Ganeti accepts anything that is executable and your language of choice should be able to interact with environment variables easily, as that is how Ganeti provides information to the hook scripts. If your code needs to interact with external HTTP APIs, MQTT or the like	 you are probably better of using Python to implement good error handling instead of shell scripts. In the end, choose whatever environment you are familiar with. 

## Where Does My Hook Run?
That depends on the operation which triggered the hook. The documentation covers this pretty well. You might need to add code to your script to avoid duplicate actions, as some hooks are executed on multiple nodes at the same time (e.g. the master node _and_ the primary node of the instance). More important: use some sort of automation to deploy your hooks to all of your nodes so that you know you have the same version of your scripts everywhere.

## Integration Into DNS/DCIM

This might well work as a pre or a post hook. If you are using a tool like Netbox or a name server like PowerDNS, you can use their respective APIs to create e.g. DNS records, update VM information (Memory/vCPUs etc.).

## Logging Actions
In the past I have encountered problems with time-sensitive applications during live migrations. To make debugging for others easier (e.g. teams debugging their application problems on your VMs), I published the migration information via Slack and also as Grafana annotations. The following code snippet will send a slack message via webhooks using the `instance-migrate` hook:

```shell
#!/bin/sh
HOST=$(hostname -f)

if [ ! "$GANETI_MASTER" = "$HOST" ]; then
  # only run this on the master
  exit 0
fi

if [ ! "$GANETI_MIGRATE_LIVE" = "True" ]; then
  # only annotate live migrations
  exit 0
fi

MESSAGE="*${GANETI_INSTANCE_NAME} migrated live* from ${GANETI_OLD_PRIMARY} to ${GANETI_NEW_PRIMARY}\non Cluster ${GANETI_CLUSTER}"

curl -X POST -H 'Content-type: application/json' --data "{\"text\": \"$MESSAGE\"}"  https://hooks.slack.com/services/YOUR/TOKENIZED/URL
```

The following snippet will post to Grafana:

```shell
#!/bin/sh
GRAFANA_ANNOTATIONS_API_URL="https://grafana.example.org/api/annotations"
GRAFANA_API_KEY="123456"
HOST=$(hostname -f)

if [ ! "$GANETI_MASTER" = "$HOST" ]; then
  # only run this on the master
  exit 0
fi

if [ ! "$GANETI_MIGRATE_LIVE" = "True" ]; then
  # only annotate live migrations
  exit 0
fi

# set grafana annotation
curl -s -H "Content-Type: application/json" -H "Authorization: Bearer ${GRAFANA_API_KEY}" -d "{ \
\"time\":$(echo $(($(date +%s) * 1000))), \
\"tags\":[\"${GANETI_INSTANCE_NAME}\",\"ganeti-live-migration\"], \
\"text\":\"Ganeti Live Migration\" \
}" ${GRAFANA_ANNOTATIONS_API_URL}
```

The result will look something like this:

<img src="/images/grafana-load-annotation.png" alt="" />

## Automating Disk Grow Operations
Ganeti supports growing existing disks of instances. However, when you use Qemu/KVM you still need to reboot the instance so that it actually “picks up” the changed device size. With more recent Qemu versions it has become possible to report the new disk size to the running Qemu process. While this could (or rather should) be handled by Ganeti itself, it is currently not. You can work around this by using a hook script:

```shell
#!/bin/bash

disk_size_var_name="GANETI_POST_INSTANCE_DISK${GANETI_DISK}_SIZE"
disk_size=${!disk_size_var_name}
disk_size_in_g="$(($disk_size/1024))"

if [[ -S "/var/run/ganeti/kvm-hypervisor/ctrl/${GANETI_INSTANCE_NAME}.monitor" ]]; then
	disk_id=$(echo info block | socat - unix:/var/run/ganeti/kvm-hypervisor/ctrl/${GANETI_INSTANCE_NAME}.monitor | grep -e "${GANETI_INSTANCE_NAME}:$GANETI_DISK" | awk -F " |:" '{ printf $1; }')
	echo block_resize $disk_id ${disk_size_in_g}G | socat - unix:/var/run/ganeti/kvm-hypervisor/ctrl/${GANETI_INSTANCE_NAME}.monitor
fi
```

Please keep in mind this should only run as a post job, after a successful grow operation! With this hook script in place, you can just online-resize the partitions/filesystems inside the instance without rebooting it.
There is also a more sophisticated [version](https://github.com/saschalucas/ganeti-hook-grow-disk) of this hook by Sascha Lucas.

## Traffic Shaping Your Instances
If you are running your own workloads on your instances, this might not be a huge problem for you. As soon as you have multiple customers with their instances on your nodes, you need to make sure that one instance can not use all network bandwidth available to the node itself, so that customers can not affect each other.

The following script is actually not a hook (but it may as well be used as one). You can run this simply on boot once using systemd and it will pre-generate the traffic shaping rules for the specified amount of tap interfaces. You can also use it as an instance-start/stop/migrate hook, but that will delete and regenerate all rules each time you start/stop/migrate an instance. If you take this route, the script probably needs a bit of a redesign.

The variable `SHAPED_INTERFACE` holds the public interface your instances use (not the bridge!).

```shell
#!/bin/bash

SHAPED_INTERFACE="bond1"
AMOUNT_OF_SUPPORTED_TAP_INTERFACES=64
ALLOWED_OUTBOUND_TRAFFIC_IN_MBIT=600
MTU=1500

# you should not need to change those
BURST_IN_BYTES=$(( ($ALLOWED_OUTBOUND_TRAFFIC_IN_MBIT * 1024 * 1024) / 8 / 100))	# based on man tc-htb
R2Q=$((($ALLOWED_OUTBOUND_TRAFFIC_IN_MBIT * 1024 * 1024) / 8 / $MTU ))          	# based on libvirt code -> virNetDevBandwidthCmdAddOptimalQuantum()
CLASS_MAJOR=0010

# R2Q must not be below 1
if [ "${R2Q}" -eq 0 ]; then
	R2Q=1
fi

# delete any existing iptables mangle rules (this should not interfere with other firewall scripts)
iptables -t mangle -F PREROUTING

# delete any existing qdisc (+ dependent classes) on the $SHAPED_INTERFACE
tc qdisc del dev ${SHAPED_INTERFACE} root 2> /dev/null

# setup root class
tc qdisc add dev ${SHAPED_INTERFACE} root handle ${CLASS_MAJOR}: htb r2q ${R2Q}

# setup traffic shaping
for INT in $(seq 0 ${AMOUNT_OF_SUPPORTED_TAP_INTERFACES}); do
	TAP_DEVICE=tap${INT}
	INT_FOR_CLASS=$((${INT} + 1))
	CLASS_MINOR=$(printf "%04x" $INT_FOR_CLASS)
	tc class add dev ${SHAPED_INTERFACE} parent ${CLASS_MAJOR}: \
    	classid ${CLASS_MAJOR}:${CLASS_MINOR} htb \
    	rate ${ALLOWED_OUTBOUND_TRAFFIC_IN_MBIT}mbit \
    	ceil ${ALLOWED_OUTBOUND_TRAFFIC_IN_MBIT}mbit \
    	burst ${BURST_IN_BYTES}

	tc filter add dev ${SHAPED_INTERFACE} parent ${CLASS_MAJOR}: \
    	handle 0x${CLASS_MINOR} \
    	protocol all \
    	fw flowid ${CLASS_MAJOR}:${CLASS_MINOR}

	iptables -t mangle -A PREROUTING -m physdev --physdev-in ${TAP_DEVICE} -j MARK --set-mark 0x${CLASS_MINOR}
done
```

## CPU Affinity/Pinning

There used to be a hook script on the [mailing list](https://groups.google.com/g/ganeti/c/3WNe4NRbD5E/m/oaJntSdxBQAJ) which takes care of pinning the vCPUs of a freshly started instance to real cores on the node. It was numa-aware and did a 1:1 match between vCPU and real core as long as there was no overcommitment of CPU resources (which sounds kinda logical, I guess). However, this script is not available any more ([link](https://www.goodbytez.de/ganeti/) is dead).
I have successfully used this script in the past after observing problems with timekeeping on idle instances. However, this has vastly improved with more recent Qemu versions and I currently do not operate any clusters using this hook.

## Conclusion
I hope you were able to find some inspiration in this blog post for your own hook scripts. What hooks do you use in your environment? Let me know via [Mastodon](https://chaos.social/@rbo_ne) and I am happy to extend this blogpost with links or additional sections!