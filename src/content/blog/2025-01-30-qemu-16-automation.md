---
title: "QEMU 스크립트 자동화"
date: 2025-01-30
tags: [QEMU, Automation, Scripting, Ansible, Python, libvirt]
description: "Bash, Python, Ansible을 활용한 QEMU VM 관리 자동화와 CI/CD 통합 방법을 학습합니다."
---

## 들어가며

매번 긴 QEMU 명령어를 입력하기 지겹다면? **자동화 스크립트**로 VM 관리를 효율화하고 재현 가능한 인프라를 구축할 수 있습니다.

## Bash 자동화

### 기본 VM 관리 스크립트

```bash
#!/bin/bash
# vm_manager.sh

set -e

VM_NAME="${1:-ubuntu-vm}"
ACTION="${2:-start}"

VM_DIR="/var/lib/vms"
VM_IMAGE="$VM_DIR/$VM_NAME.qcow2"
VM_PID="/var/run/qemu/$VM_NAME.pid"
QMP_SOCK="/tmp/qmp-$VM_NAME.sock"

function create_vm() {
    echo "Creating VM: $VM_NAME"

    # 디스크 이미지 생성
    qemu-img create -f qcow2 "$VM_IMAGE" 20G

    # Base image로부터 복사 (선택사항)
    # qemu-img create -f qcow2 -b /var/lib/vms/base.qcow2 -F qcow2 "$VM_IMAGE"

    echo "VM disk created: $VM_IMAGE"
}

function start_vm() {
    if [ -f "$VM_PID" ] && kill -0 $(cat "$VM_PID") 2>/dev/null; then
        echo "VM already running: $VM_NAME"
        return
    fi

    echo "Starting VM: $VM_NAME"

    qemu-system-x86_64 \
        -enable-kvm \
        -name "$VM_NAME" \
        -m 4G \
        -smp 4 \
        -drive file="$VM_IMAGE",format=qcow2,if=virtio \
        -netdev user,id=net0,hostfwd=tcp::2222-:22 \
        -device virtio-net-pci,netdev=net0 \
        -qmp unix:"$QMP_SOCK",server,nowait \
        -daemonize \
        -pidfile "$VM_PID"

    echo "VM started: $VM_NAME (PID: $(cat $VM_PID))"
}

function stop_vm() {
    if [ ! -f "$VM_PID" ]; then
        echo "VM not running: $VM_NAME"
        return
    fi

    echo "Stopping VM: $VM_NAME"

    # Graceful shutdown via QMP
    echo '{"execute": "qmp_capabilities"}' | nc -U "$QMP_SOCK"
    echo '{"execute": "system_powerdown"}' | nc -U "$QMP_SOCK"

    # Wait for shutdown (max 30 seconds)
    for i in {1..30}; do
        if ! kill -0 $(cat "$VM_PID") 2>/dev/null; then
            echo "VM stopped gracefully"
            rm -f "$VM_PID"
            return
        fi
        sleep 1
    done

    # Force kill if still running
    echo "Force killing VM"
    kill $(cat "$VM_PID")
    rm -f "$VM_PID"
}

function status_vm() {
    if [ -f "$VM_PID" ] && kill -0 $(cat "$VM_PID") 2>/dev/null; then
        echo "VM running: $VM_NAME (PID: $(cat $VM_PID))"

        # Get memory info via QMP
        echo '{"execute": "qmp_capabilities"}' | nc -U "$QMP_SOCK" > /dev/null
        BALLOON=$(echo '{"execute": "query-balloon"}' | nc -U "$QMP_SOCK" | jq -r '.return.actual // 0')
        BALLOON_MB=$((BALLOON / 1024 / 1024))
        echo "Memory: ${BALLOON_MB}MB"
    else
        echo "VM not running: $VM_NAME"
    fi
}

function snapshot_vm() {
    SNAP_NAME="${3:-auto-$(date +%Y%m%d_%H%M%S)}"

    echo "Creating snapshot: $SNAP_NAME"
    qemu-img snapshot -c "$SNAP_NAME" "$VM_IMAGE"
    echo "Snapshot created: $SNAP_NAME"
}

function list_snapshots() {
    echo "Snapshots for $VM_NAME:"
    qemu-img snapshot -l "$VM_IMAGE"
}

# Main
case "$ACTION" in
    create)
        create_vm
        ;;
    start)
        start_vm
        ;;
    stop)
        stop_vm
        ;;
    restart)
        stop_vm
        sleep 2
        start_vm
        ;;
    status)
        status_vm
        ;;
    snapshot)
        snapshot_vm
        ;;
    snapshots)
        list_snapshots
        ;;
    *)
        echo "Usage: $0 <vm-name> {create|start|stop|restart|status|snapshot|snapshots}"
        exit 1
        ;;
esac
```

### 사용 예시

```bash
# VM 생성
./vm_manager.sh web-server create

# VM 시작
./vm_manager.sh web-server start

# VM 상태 확인
./vm_manager.sh web-server status
VM running: web-server (PID: 12345)
Memory: 4096MB

# 스냅샷 생성
./vm_manager.sh web-server snapshot before-update

# VM 중지
./vm_manager.sh web-server stop
```

### 배치 VM 관리

```bash
#!/bin/bash
# vm_cluster.sh

VMS=("web1" "web2" "db1" "cache1")

function start_all() {
    for vm in "${VMS[@]}"; do
        ./vm_manager.sh "$vm" start &
    done
    wait
    echo "All VMs started"
}

function stop_all() {
    for vm in "${VMS[@]}"; do
        ./vm_manager.sh "$vm" stop &
    done
    wait
    echo "All VMs stopped"
}

function status_all() {
    for vm in "${VMS[@]}"; do
        ./vm_manager.sh "$vm" status
    done
}

# Main
case "${1:-status}" in
    start) start_all ;;
    stop) stop_all ;;
    status) status_all ;;
    *) echo "Usage: $0 {start|stop|status}" ;;
esac
```

## Python 자동화

### libvirt Python 라이브러리

```python
#!/usr/bin/env python3
# vm_manager.py

import libvirt
import sys
import xml.etree.ElementTree as ET

class VMManager:
    def __init__(self, uri='qemu:///system'):
        """libvirt 연결"""
        self.conn = libvirt.open(uri)
        if self.conn is None:
            raise Exception(f'Failed to open connection to {uri}')

    def list_vms(self):
        """모든 VM 목록"""
        domains = self.conn.listAllDomains()
        for domain in domains:
            state, _ = domain.state()
            state_str = {
                libvirt.VIR_DOMAIN_RUNNING: 'running',
                libvirt.VIR_DOMAIN_BLOCKED: 'blocked',
                libvirt.VIR_DOMAIN_PAUSED: 'paused',
                libvirt.VIR_DOMAIN_SHUTDOWN: 'shutdown',
                libvirt.VIR_DOMAIN_SHUTOFF: 'shutoff',
                libvirt.VIR_DOMAIN_CRASHED: 'crashed',
            }.get(state, 'unknown')

            print(f"{domain.name()}: {state_str}")

    def create_vm(self, name, memory_mb=4096, vcpus=4, disk_gb=20):
        """새 VM 생성"""
        # 디스크 이미지 생성
        import subprocess
        disk_path = f'/var/lib/libvirt/images/{name}.qcow2'
        subprocess.run([
            'qemu-img', 'create', '-f', 'qcow2',
            disk_path, f'{disk_gb}G'
        ], check=True)

        # XML 정의
        xml = f'''
        <domain type='kvm'>
          <name>{name}</name>
          <memory unit='MiB'>{memory_mb}</memory>
          <vcpu>{vcpus}</vcpu>
          <os>
            <type arch='x86_64'>hvm</type>
            <boot dev='hd'/>
          </os>
          <features>
            <acpi/>
            <apic/>
          </features>
          <cpu mode='host-passthrough'/>
          <devices>
            <disk type='file' device='disk'>
              <driver name='qemu' type='qcow2'/>
              <source file='{disk_path}'/>
              <target dev='vda' bus='virtio'/>
            </disk>
            <interface type='network'>
              <source network='default'/>
              <model type='virtio'/>
            </interface>
            <console type='pty'>
              <target type='serial' port='0'/>
            </console>
          </devices>
        </domain>
        '''

        domain = self.conn.defineXML(xml)
        print(f"VM created: {name}")
        return domain

    def start_vm(self, name):
        """VM 시작"""
        try:
            domain = self.conn.lookupByName(name)
            if domain.isActive():
                print(f"VM already running: {name}")
            else:
                domain.create()
                print(f"VM started: {name}")
        except libvirt.libvirtError as e:
            print(f"Error: {e}")

    def stop_vm(self, name, force=False):
        """VM 중지"""
        try:
            domain = self.conn.lookupByName(name)
            if not domain.isActive():
                print(f"VM not running: {name}")
            else:
                if force:
                    domain.destroy()  # Force shutdown
                    print(f"VM force stopped: {name}")
                else:
                    domain.shutdown()  # Graceful shutdown
                    print(f"VM shutdown initiated: {name}")
        except libvirt.libvirtError as e:
            print(f"Error: {e}")

    def snapshot_vm(self, name, snapshot_name):
        """스냅샷 생성"""
        domain = self.conn.lookupByName(name)

        xml = f'''
        <domainsnapshot>
          <name>{snapshot_name}</name>
          <description>Created by vm_manager.py</description>
        </domainsnapshot>
        '''

        domain.snapshotCreateXML(xml)
        print(f"Snapshot created: {snapshot_name}")

    def list_snapshots(self, name):
        """스냅샷 목록"""
        domain = self.conn.lookupByName(name)
        snapshots = domain.listAllSnapshots()

        print(f"Snapshots for {name}:")
        for snap in snapshots:
            print(f"  - {snap.getName()}")

    def get_stats(self, name):
        """VM 통계"""
        domain = self.conn.lookupByName(name)

        if not domain.isActive():
            print(f"VM not running: {name}")
            return

        # CPU 시간
        info = domain.info()
        print(f"\n=== {name} Statistics ===")
        print(f"State: {info[0]}")
        print(f"Max Memory: {info[1] // 1024}MB")
        print(f"Used Memory: {info[2] // 1024}MB")
        print(f"vCPUs: {info[3]}")
        print(f"CPU Time: {info[4] / 1000000000:.2f}s")

        # 네트워크 통계
        xml = domain.XMLDesc()
        root = ET.fromstring(xml)
        for iface in root.findall(".//interface[@type='network']"):
            target = iface.find('target')
            if target is not None:
                dev = target.get('dev')
                stats = domain.interfaceStats(dev)
                print(f"\nNetwork ({dev}):")
                print(f"  RX: {stats[0] / 1024 / 1024:.2f}MB")
                print(f"  TX: {stats[4] / 1024 / 1024:.2f}MB")

    def close(self):
        """연결 종료"""
        self.conn.close()


def main():
    if len(sys.argv) < 2:
        print("Usage: vm_manager.py {list|create|start|stop|snapshot|snapshots|stats} [args...]")
        sys.exit(1)

    manager = VMManager()
    command = sys.argv[1]

    try:
        if command == 'list':
            manager.list_vms()

        elif command == 'create':
            name = sys.argv[2]
            manager.create_vm(name)

        elif command == 'start':
            name = sys.argv[2]
            manager.start_vm(name)

        elif command == 'stop':
            name = sys.argv[2]
            force = '--force' in sys.argv
            manager.stop_vm(name, force)

        elif command == 'snapshot':
            name = sys.argv[2]
            snap_name = sys.argv[3] if len(sys.argv) > 3 else f'auto-{name}'
            manager.snapshot_vm(name, snap_name)

        elif command == 'snapshots':
            name = sys.argv[2]
            manager.list_snapshots(name)

        elif command == 'stats':
            name = sys.argv[2]
            manager.get_stats(name)

        else:
            print(f"Unknown command: {command}")

    finally:
        manager.close()


if __name__ == '__main__':
    main()
```

### 사용 예시

```bash
# VM 목록
python3 vm_manager.py list
web1: running
web2: running
db1: shutoff

# VM 생성
python3 vm_manager.py create test-vm

# VM 시작
python3 vm_manager.py start test-vm

# 통계 확인
python3 vm_manager.py stats web1

=== web1 Statistics ===
State: 1
Max Memory: 4096MB
Used Memory: 2048MB
vCPUs: 4
CPU Time: 1234.56s

Network (vnet0):
  RX: 123.45MB
  TX: 67.89MB
```

## Ansible 자동화

### Ansible Playbook

```yaml
# playbooks/qemu_vm.yml
---
- name: QEMU VM Management
  hosts: hypervisor
  become: yes
  vars:
    vm_name: "{{ vm_name | default('default-vm') }}"
    vm_memory: "{{ vm_memory | default(4096) }}"
    vm_cpus: "{{ vm_cpus | default(4) }}"
    vm_disk_size: "{{ vm_disk_size | default('20G') }}"
    vm_image_path: "/var/lib/libvirt/images/{{ vm_name }}.qcow2"

  tasks:
    - name: Install required packages
      apt:
        name:
          - qemu-kvm
          - libvirt-daemon-system
          - libvirt-clients
          - python3-libvirt
        state: present
        update_cache: yes

    - name: Create VM disk image
      command: >
        qemu-img create -f qcow2 {{ vm_image_path }} {{ vm_disk_size }}
      args:
        creates: "{{ vm_image_path }}"

    - name: Define VM
      community.libvirt.virt:
        command: define
        xml: |
          <domain type='kvm'>
            <name>{{ vm_name }}</name>
            <memory unit='MiB'>{{ vm_memory }}</memory>
            <vcpu>{{ vm_cpus }}</vcpu>
            <os>
              <type arch='x86_64'>hvm</type>
              <boot dev='hd'/>
            </os>
            <features>
              <acpi/>
              <apic/>
            </features>
            <cpu mode='host-passthrough'/>
            <devices>
              <disk type='file' device='disk'>
                <driver name='qemu' type='qcow2'/>
                <source file='{{ vm_image_path }}'/>
                <target dev='vda' bus='virtio'/>
              </disk>
              <interface type='network'>
                <source network='default'/>
                <model type='virtio'/>
              </interface>
              <console type='pty'>
                <target type='serial' port='0'/>
              </console>
            </devices>
          </domain>

    - name: Start VM
      community.libvirt.virt:
        name: "{{ vm_name }}"
        state: running

    - name: Set VM to autostart
      community.libvirt.virt:
        name: "{{ vm_name }}"
        autostart: yes

    - name: Get VM info
      community.libvirt.virt:
        command: info
      register: vm_info

    - name: Display VM info
      debug:
        var: vm_info
```

### 인벤토리 파일

```ini
# inventory/hosts
[hypervisor]
qemu-host1 ansible_host=192.168.1.100 ansible_user=admin

[hypervisor:vars]
ansible_python_interpreter=/usr/bin/python3
```

### 실행

```bash
# 단일 VM 생성
ansible-playbook -i inventory/hosts playbooks/qemu_vm.yml \
  -e "vm_name=web1 vm_memory=8192 vm_cpus=8"

# 여러 VM 생성
for vm in web1 web2 web3; do
  ansible-playbook -i inventory/hosts playbooks/qemu_vm.yml \
    -e "vm_name=$vm"
done
```

### VM 클러스터 배포

```yaml
# playbooks/deploy_cluster.yml
---
- name: Deploy VM Cluster
  hosts: hypervisor
  become: yes

  vars:
    vms:
      - { name: 'web1', memory: 4096, cpus: 4, disk: '20G' }
      - { name: 'web2', memory: 4096, cpus: 4, disk: '20G' }
      - { name: 'db1', memory: 8192, cpus: 8, disk: '100G' }
      - { name: 'cache1', memory: 2048, cpus: 2, disk: '10G' }

  tasks:
    - name: Create and start VMs
      include_tasks: qemu_vm.yml
      vars:
        vm_name: "{{ item.name }}"
        vm_memory: "{{ item.memory }}"
        vm_cpus: "{{ item.cpus }}"
        vm_disk_size: "{{ item.disk }}"
      loop: "{{ vms }}"
```

## CI/CD 통합

### GitLab CI

```yaml
# .gitlab-ci.yml
stages:
  - test
  - deploy

test_vm:
  stage: test
  script:
    - qemu-img create -f qcow2 test.qcow2 10G
    - qemu-system-x86_64 -m 2G -drive file=test.qcow2 -nographic -kernel vmlinuz -append "console=ttyS0" &
    - sleep 30
    - pkill qemu
  tags:
    - qemu

deploy_vm:
  stage: deploy
  script:
    - ansible-playbook -i inventory/production playbooks/qemu_vm.yml
  only:
    - main
  tags:
    - qemu
```

### GitHub Actions

```yaml
# .github/workflows/vm-deploy.yml
name: Deploy QEMU VM

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v2

      - name: Install dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y qemu-kvm libvirt-daemon-system

      - name: Create VM
        run: |
          ./scripts/vm_manager.sh production-vm create

      - name: Start VM
        run: |
          ./scripts/vm_manager.sh production-vm start

      - name: Health check
        run: |
          sleep 30
          ./scripts/vm_manager.sh production-vm status
```

### Terraform 통합

```hcl
# main.tf
terraform {
  required_providers {
    libvirt = {
      source = "dmacvicar/libvirt"
    }
  }
}

provider "libvirt" {
  uri = "qemu:///system"
}

resource "libvirt_volume" "ubuntu" {
  name   = "ubuntu.qcow2"
  pool   = "default"
  source = "https://cloud-images.ubuntu.com/releases/22.04/release/ubuntu-22.04-server-cloudimg-amd64.img"
  format = "qcow2"
}

resource "libvirt_domain" "vm" {
  name   = "terraform-vm"
  memory = "4096"
  vcpu   = 4

  disk {
    volume_id = libvirt_volume.ubuntu.id
  }

  network_interface {
    network_name = "default"
  }

  console {
    type        = "pty"
    target_port = "0"
    target_type = "serial"
  }
}

output "vm_id" {
  value = libvirt_domain.vm.id
}
```

```bash
# Terraform 사용
terraform init
terraform plan
terraform apply
```

## 모니터링 자동화

### Prometheus Exporter

```python
#!/usr/bin/env python3
# qemu_exporter.py

from prometheus_client import start_http_server, Gauge
import libvirt
import time

# Metrics
vm_state = Gauge('qemu_vm_state', 'VM state', ['vm_name'])
vm_memory_used = Gauge('qemu_vm_memory_used_bytes', 'VM memory used', ['vm_name'])
vm_cpu_time = Gauge('qemu_vm_cpu_time_seconds', 'VM CPU time', ['vm_name'])

def collect_metrics():
    conn = libvirt.open('qemu:///system')

    for domain in conn.listAllDomains():
        name = domain.name()

        # State
        state, _ = domain.state()
        vm_state.labels(vm_name=name).set(state)

        if domain.isActive():
            # Memory
            info = domain.info()
            vm_memory_used.labels(vm_name=name).set(info[2] * 1024)

            # CPU time
            vm_cpu_time.labels(vm_name=name).set(info[4] / 1000000000)

    conn.close()

if __name__ == '__main__':
    start_http_server(9100)
    print("Exporter running on :9100")

    while True:
        collect_metrics()
        time.sleep(15)
```

## 다음 단계

QEMU 자동화를 마스터했습니다! 다음 글에서는:
- **QEMU와 Docker 통합**
- 컨테이너 내 QEMU
- Nested 가상화

---

**시리즈 목차**
1-15. [이전 글들]
16. **QEMU 스크립트 자동화** ← 현재 글

> 💡 **Quick Tip**: Infrastructure as Code를 실천하세요. Ansible이나 Terraform으로 VM 인프라를 정의하면 재현 가능하고 버전 관리가 가능한 인프라를 구축할 수 있습니다!
