resource "proxmox_vm_qemu" "clones" {
    for_each = {
        for vm in var.clones : vm.name => vm
    }

    name        = each.value.name
    vmid        = each.value.vmid
    target_node = each.value.node

    # Clone from template
    clone   = var.template_id
    storage = each.value.storage

    # Basic configuration
    cores   = each.value.cores
    sockets = 1
    memory  = each.value.memory
    onboot  = each.value.onboot

    # Network configuration
    network {
        model      = each.value.network_model
        bridge     = each.value.network_bridge
        vlan       = each.value.network_vlan
        macaddress = each.value.network_mac == "auto" ? null : each.value.network_mac
        # Note: "auto" → can be set to null to let Proxmox automatically assign MAC
    }

    # Disk configuration
    disk {
        size    = each.value.disk_size
        type    = each.value.disk_type
        storage = each.value.storage
        ssd     = each.value.ssd_emulation
    }
}
