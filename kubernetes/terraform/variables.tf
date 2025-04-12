variable "pm_api_url" {
    type        = string
    description = "Proxmox API URL"
}

variable "pm_user" {
    type        = string
    description = "Proxmox login account"
}

variable "pm_password" {
    type        = string
    description = "Proxmox login password"
    sensitive   = true
}

variable "pm_tls_insecure" {
    type        = bool
    description = "Allow TLS insecure?"
    default     = true
}

variable "template_id" {
    type        = string
    description = "ID or name of the original VM template"
    default     = "145"
}

variable "clones" {
    type = list(object({
        # Basic VM
        name      = string
        vmid      = number
        node      = string
        storage   = string
        cores     = number
        memory    = number
        disk_size = number

        # Network
        network_model  = string   
        network_bridge = string   
        network_vlan   = number
        network_mac    = string

        # Disk
        disk_type     = string
        ssd_emulation = bool

        # Other
        onboot = bool  # Start VM when host boots
    }))
    description = <<EOT
List of VMs to clone:
- name, vmid, node, storage
- cores, memory, disk_size
- network_model, network_bridge, network_vlan, network_mac
- disk_type, ssd_emulation
- onboot
EOT
}
