---
title: "A Decade of Using Ansible: Takeaways & Best Practices"
description: Being a long time Ansible user, I have accumulated a lot of habits ofer the years.
date: 2024-02-21
tags:
- ansible
---
My first encounter with Ansible was at a conference in Berlin during a talk given by the great [Jan-Piet Mens](https://jpmens.net/) in 2014. The only automation tool I had been using up until then was Puppet (not counting homegrown Bash scripts here). For the last ten years Ansible has been a constant in my toolbox, both work-related and private. The following points convinced me back in 2014:

- agent-less
- uses SSH as transport (delegates authentication to a proven and widely used mechanism)
- Python-based: easy to extend with custom modules, filters, lookup plugins etc.
- playbooks are easy to read, follow and understand
- a broad range of modules (even in 2014!)

The following blog post assumes at least some familiarity with Ansible - you should know your way around playbooks, roles, inventories, host- and group-vars. Some things might be old news to you, others might be new.

Please consider the following as an incomplete guide to "things I have gotten used to in the past". It might contradict with official best practices and of course there may be better solutions to the problems described.

## Use Roles, Environments and Possibly Inventory Plugins

I usually keep my Ansible roles, playbooks and variables in a single repository. Over the years I have defaulted to the following directory structure for an Ansible repository:

```
.
├── ansible.cfg
├── environments/
│   ├── dev/
│   │   ├── group_vars/
│   │   ├── host_vars/
│   │   └── inventory
│   └── live/
│       ├── group_vars/
│       ├── host_vars/
│       └── inventory
├── filter_plugins/
├── library/
├── lookup_plugins/
├── roles/
└── tasks/
```

Playbooks are stored on the top level. They never contain tasks directly but only include roles from the `roles/` folder. Roles allow you to separate your tasks and reuse them in different playbooks easily. To support different environments (e.g. `dev`/`live` as shown) the inventories are separated by folder, so you would invoke Ansible on the top level as `ansible-playbook -i environments/dev/inventory ...`. If you need to extend Ansible with custom [filters](https://docs.ansible.com/ansible/latest/dev_guide/developing_plugins.html#filter-plugins) or [lookup plugins](https://docs.ansible.com/ansible/latest/dev_guide/developing_plugins.html#lookup-plugins), simply drop them into the respective folders. `library` would be to place to drop custom Ansible modules. However, for this to work your `ansible.cfg` needs to contain the following lines:

```ini
[defaults]
library = ./library
```

In general it is a good habit to have an `ansible.cfg` in your Ansible repository to keep required/custom configurations close to your playbooks/environments.

Sooner or later you will find that several of your playbooks or roles share the same small snippets of tasks (e.g. "disable monitoring for a service" or "get a certificate"). If these snippets do not warrant a role on their own, you can drop them into small YAML files in the `tasks` folder and include them in any playbook or role like this:

```yaml
    - include_tasks: tasks/disable_monitoring.yml
      vars:
        services:
          - my_service
          - my_other_service
```

## Ansible Vault

At some point you will need to store things in your `host_vars` or `group_vars` that must to be kept secret like API keys or passwords. This is where [Ansible Vault](https://docs.ansible.com/ansible/latest/vault_guide/index.html) comes in handy. If you are using Ansible for your personal environment, you will probably be fine with using one global vault password.
However, if you are in a work environment and possibly share your Ansible setup with many other teams, multiple separate vault IDs are a handy way to limit the blast radius when a single vault password has been compromised.

You can create a vault file with a specific vault ID (`myteam`) like this:

```shell
ansible-vault create --vault-id myteam@prompt vault.yml
```

You can also provide the same vault ID password interactively to Ansible like this:

```shell
ansible-playbook -i inventory --vault-id myteam@prompt playbook.yml
```

You can also query for multiple vault ID passwords if required by your playbook:

```shell
ansible-playbook -i inventory --vault-id myteam@prompt --vault-id otherteam@prompt playbook.yml
```

The `@prompt` suffix will cause Ansible to interactively prompt for the vault password. You can also create helper scripts which read the relevant password from some source (e.g. the `pass` password manager) and provide it to ansible automatically:

```shell
ansible-playbook -i inventory --vault-id myteam@retrieve-myteam-password.sh playbook.yml
```

The following shell alias (saved in `~/.profile` or `~/.bashrc`) allows you to always have one or multiple vault passwords provided to Ansible:

```shell
alias ansible-playbook='ansible-playbook --vault-id myteam@retrieve-myteam-password.sh'
```

### Where and How to Store Vault Data

While you _can_ use so called inline vaults, you really should not. The other option is to have the entire YAML document encrypted by Ansible vault. The following YAML file is an example of an inline vault:

```yaml
some_non_confidential_var: true
some_other_non_confidential_var: "yolo"
super_confidential_stuff: !vault |
$ANSIBLE_VAULT;1.1;AES256
32656432386638396362303630666363653830633966663038643330306137643639336361333337
6665323361333865653635633038316133316266653530610a653534313232363664363066303337
61656531383861303232366464663137303931383531303236393838656239323765396261656565
3536633165383762350a333761656664333739626335343563623461323137366531663234383137
30363338383661646534366266646165313666633561613730353836666336323439
```

On the one hand, inline vaults ensure that all variables which belong together can be located in the same YAML file. If you are using `grep` or similiar to locate `super_confidential_stuff`, you will find exactly where it has been defined (and where it is used). On the other hand, the vault part bloats your YAML file and there is no easy way to decrypt it, without copy/pasting it somewhere else and using `ansible-vault` on that. Replacing the encrypted data also includes quite a bit of copy/pasting. Finally, if you provide the wrong vault password to Ansible, the playbook will run up to the point where it tries to read the inline vault data, fails to decrypt and stop your entire playbook run.

To avoid the problems stated above but also retain the advantages, the following workflow has proven itself over the years: Imagine you have a `host_vars` file for a server called `app01.example.org`, containing the above example YAML data. We will now transform this into the following structure:

`host_vars/app01.example.org/main.yml`:

```yaml
{% raw %}some_non_confidential_var: true
some_other_non_confidential_var: "yolo"
super_confidential_stuff: "{{ vault_super_confidential_stuff }}"
{% endraw %}
```

`host_vars/app01.example.org/vault.yml`:

```
$ANSIBLE_VAULT;1.1;AES256
32656432386638396362303630666363653830633966663038643330306137643639336361333337
[...]
```

Where the decrypted content of the above file will be:

```yaml
---
vault_super_confidential_stuff: "secret data"
```

This approach combines the following advantages:
- you can `grep` all variables used in your playbook or templates and find their definition within your `host_vars` or `group_vars`
- variables with secrets directly map to a similar named variable in an encrypted file in the same folder
- you can directly view or edit your encrypted `vault.yml` with `ansible-vault view|edit` (or any vault integration in your IDE)
- the vault data is located "near" its non-vault counterparts
- if you forget to provide a vault password _or_ provide the wrong vault password to `ansible-playbook`, Ansible will fail early and not run the playbook at all (which is better than failing half-way through the execution as with undecryptable inline vaults)

## Use Handlers (Along with flush_handlers if Required)

[Handlers](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_handlers.html) have been around for quite a while. They allow the execution of Ansible tasks when other tasks have changed something (e.g. updated a configuration file or installed a package). Whenever you spot a combination of tasks with `register: blah` followed by `when: blah is changed`, you should immediatly refactor that to a handler. This will greatly improve the readability of your roles and make it especially easy if you have many tasks which require the same command to run at the end (e.g. a configuration split across many files).

If your playbook includes many roles/takes a long time, you sometimes want or even require your handlers to be executed earlier than at the very end of the playbook. This might be relevant if you configure service A followed by service B - but service B requires A to be already up and running. You can use the following [meta task](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/meta_module.html) anywhere in your playbook/roles to execute all handlers that have been notified/queued up to this point:

```yaml
- name: Flush all queued handlers now
  ansible.builtin.meta: flush_handlers
```

## Use Meaningful and Scoped Variable Names

There is no glory in using short and ambigious variable names like `name` or `path`. Unless your variable has really a global meaning to your entire environment, you should always prefix variables used in specific tasks or templates with e.g. your role's name. This way you can avoid variable name clashes and unpredictable behaviour across multiple roles.
Even within one role, using verbose and consise variable names improves readability and maintainability a lot. As we are in a Python world, sticking to [PEP-8](https://peps.python.org/pep-0008/#function-and-variable-names) is a good idea:

> Function names should be lowercase, with words separated by underscores as necessary to improve readability.
>
> Variable names follow the same convention as function names.
>
> mixedCase is allowed only in contexts where that’s already the prevailing style (e.g. threading.py), to retain backwards compatibility.

You must never use dashes in variable names though. The dashes will be interpreted as substraction by the Jinja template engine and cause all sorts of trouble.

Good:

```yaml
---
apache_tls_listen_port: 443
snmpd_system_location: "closet"
myapplication_unpriv_service_user: "nobody"
```

Bad:

```yaml
---
port: 80
system-location: "closet"
user: "nobody"
```

## YAML, The Norway Problem and Octal Numbers

While YAML is an accessible and easy to read format, it is far from being uncomplicated. The famous "[Norway Problem](https://www.bram.us/2022/01/11/yaml-the-norway-problem/)" is just one example of its quirks. As a rule of thumb: always quote strings to avoid unwanted type inference. While the `yes|no|true|false` dilemma should be well known by now, there are also lesser known issues: if you are using the `file`, `copy` or `template` modules, you may (should!) specify a file mode using a numeric/octal representation (e.g. `0755`, `0644`). However, if you do not quote this value, YAML will interpret this as an octal number and Ansible will end up with the decimal representation of said octal number.

Let's do a quick Python test:

```python
>>> import yaml
>>> yaml.safe_load("""
... ---
... number: 0755
... """)
{'number': 493}
```

If passed to ansible as a file mode, this would lead to rather unexpected results. With proper quoting, the result will look like expected:

```python
>>> import yaml
>>> yaml.safe_load("""
... ---
... number: '0755'
... """)
{'number': '0755'}
```

## JSON Templating

If you find yourself writing a Jinja2 Template for a JSON file, you will sooner or later stumble across proper quoting. Let's assume the following template:

```json
{
{% raw %}
"author": "{{ author }}",
"title": "{{ title }}",
"year": {{ year }}
{% endraw %}
}
```

We now need to specifiy `author` and `title` as variables in e.g. some `host_vars` or `group_vars` file:

```yaml
---
author: 'Rudolph Bott'
title: 'My First Book'
year: 2024
```

This will work well. However, let's assume a different title:

```yaml
---
author: 'Rudolph Bott'
title: 'My "First" Book'
year: 2024
```

Ansible/Jinja will render the template just fine. But it will create broken JSON due to the use of double quotes inside the `title` string, hence breaking the JSON syntax. You _could_ easily solve this using backslashes (e.g. `'My \"First\" Book'`) in the YAML definition. But that might break the usage of the `title` variable in other places, which do not need/require escaping. You _could_ also use the [`replace` filter](https://jinja.palletsprojects.com/en/3.1.x/templates/#jinja-filters.replace). But that will be just re-inventing the wheel, because Ansible comes with a powerful filter which knows all about proper JSON encoding: the [`ansible.builtin.to_json` filter](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/to_json_filter.html).

Just keep in mind that it will _include_ the sourrounding quotes, so your Jinja template should look like this:

```json
{
{% raw %}
"author": "{{ author }}",
"title": {{ title | to_json }},
"year": {{ year }}
{% endraw %}
}
```

Just for the sake of completeness: `to_json` can also encode entire data structures, not just plain strings. The following will achieve exactly the same as above, without any JSON templating:

```yaml
---
book_data:
author: 'Rudolph Bott'
title: 'My "First" Book'
year: 2024
```

```jinja2
{% raw %}{{ book_data | to_json }}{% endraw %}
```

## Working with many hosts

Ansible is not exactly known to be lightning fast. The [Mitogen plugin](https://mitogen.networkgenomics.com/ansible_detailed.html) was the single greatest improvement to Ansible execution times I have ever seen. However, I have not been using it for the last years because AFAIR it was broken with Ansible 2.10+ for quite a while (or still is?). However, there are other built-in ways to speed up your playbook execution times.

### Use Persistent SSH Connections

Ansible supports persistent SSH connections. That means it will instruct SSH to open a connection to a server and keep it running in the background for a given time. If you execute a playbook against the same host again within that timeframe, it will reuse the existing connection and not negotiate a new one. For this to work, you need to configure the timeout and a path to a socket which will be created by SSH per connection. This can be achieved by creating a file named `ansible.cfg` in your playbook repository with the following content:

```ini
[ssh_connection]
control_path=%(directory)s/CP-%%C
ssh_args=-o ControlPersist=60m -o ControlMaster=auto
pipelining = True
```

### Raise Fork Limit

By default, Ansible limits itself to just **5** forks. That means that even when you set `serial: 40` (or not use `serial` at all) in your playbook, Ansible will not execute the same task on 40 hosts at the same time but rather in batches of 5. If you are working with many hosts and have a decent machine at hand to run your playbooks, you should raise this limit in your `ansible.cfg` to 50, 100 or even 200. 

```ini
[defaults]
forks = 100
```

## Making Ansible Playbooks More Robust

Ansible offers multiple ways to make your live with large playbooks, large numbers of hosts or even both easier.

### Set An Error Margin For Your Playbooks

If you need to run a playbook against many hosts (let's say 300), you will most likely instruct Ansible to process your hosts in batches (by setting `serial` to something like 40). However, one single failed task/host will end your entire playbook run which might or might not be what you expect. In many cases the strategy "finish as much as possible and inspect anything that failed in the end" will greatly improve your day. You can instruct Ansible to allow a certain percentage of hosts to fail within each batch of hosts:

```yaml
---
- hosts: all
  serial: 40
  max_fail_percentage: 20
  tasks:
    - ...
```

The above snippet will run your playbook in batches of 40 hosts and allows up to 8 failed hosts per batch. Failed hosts will be listed in the summary output at the end of your playbook run and you can take your time to examine the causes of your failed tasks/hosts. This will ensure that your 2 hour playbook run will actually finish most of its hosts without being stopped in its tracks after 10 minutes by a single bad host.

### Block / Rescue / Always Exception Handling

Especially with playbooks that are running for a long time and which span many hosts you find yourself in a situation where you need to gracefully handle errors without stopping the entire playbook run. You also might have to ensure that certain cleanup tasks run _if_ or especially _when_ a step in the playbook fails. Luckily Ansible has ported Python's exception model (sort of) to the Ansible world:

#### Try...Except
Detect a failing task and execute some other tasks **if** that happens:
```yaml
- tasks:
  - block:
    - name: some stupid task which might fail
      service:
        name: someservice
        state: reloaded
  - rescue:
    - name: Reloading failed, go for a restart
      service:
        name: someservice
        state: restarted
```

#### Try...Finally
Detect a failing task and **always** execute some other tasks:
```yaml
- tasks:
  - block:
    - name: Disable Monitoring For Deployment
      command:
        cmd: /usr/local/bin/disable-monitoring.sh

    - name: Restart Service
      service:
        name: someservice
        state: restarted

  - always:
    - name: Enable Monitoring After Deployment
      command:
        cmd: /usr/local/bin/enable-monitoring.sh
```

Of course you can also use a combination of `block`, `rescue`, _and_ `always`. You can find more information on this subject in the [official documenation](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_blocks.html#handling-errors-with-blocks).


## Useful links and resources

The Ansible documentation contains a list of mostly useful [best practices](https://docs.ansible.com/ansible/9/tips_tricks/ansible_tips_tricks.html), you should read and understand them. Red Hat has various blog posts about Ansible, e.g. [8 ways to speed up your Ansible playbooks](https://www.redhat.com/sysadmin/faster-ansible-playbook-execution) or how to [Find mistakes in your playbooks with Ansible Lint](https://www.redhat.com/sysadmin/ansible-lint). If you use Netbox as your inventory system, you can most probably ditch your file based inventory and use [this inventory plugin](https://docs.ansible.com/ansible/latest/collections/netbox/netbox/nb_inventory_inventory.html) to retrieve the lists of hosts and their settings directly from Netbox. The same also works for [AWS/EC2](https://docs.ansible.com/ansible/latest/collections/amazon/aws/aws_ec2_inventory.html) and many other possible data sources.

I hope you have learned something new while reading this blog post. If you have other suggestions or find some of the ideas questionable, please do not hesitate to contact me on [Mastodon](https://chaos.social/@rbo_ne)!
