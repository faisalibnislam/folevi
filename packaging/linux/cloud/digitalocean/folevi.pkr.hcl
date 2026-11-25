# DigitalOcean Marketplace 1-Click image for Folevi Server (Packer, digitalocean plugin).
# Follows github.com/digitalocean/marketplace-partners: first-boot script in per-instance, an MOTD, then
# 90-cleanup.sh and 99-img-check.sh last. Build (needs a DigitalOcean API token in DIGITALOCEAN_TOKEN, never
# committed):  packer init . && packer build -var folevi_version=1.5.73 .
# Building creates a snapshot in the owner's DigitalOcean account. Do not run without the owner's OK.
packer {
  required_plugins {
    digitalocean = {
      version = ">= 1.4.0"
      source  = "github.com/digitalocean/digitalocean"
    }
  }
}

variable "folevi_version" { type = string }
variable "region" {
  type    = string
  default = "ams3"
}

source "digitalocean" "folevi" {
  image         = "ubuntu-24-04-x64"
  region        = var.region
  size          = "s-1vcpu-2gb"
  ssh_username  = "root"
  snapshot_name = "folevi-server-${var.folevi_version}-{{timestamp}}"
}

build {
  sources = ["source.digitalocean.folevi"]

  provisioner "shell" {
    inline = ["cloud-init status --wait"]
  }

  provisioner "file" {
    source      = "files/etc/"
    destination = "/etc/"
  }

  provisioner "file" {
    source      = "files/var/"
    destination = "/var/"
  }

  provisioner "shell" {
    environment_vars = ["DEBIAN_FRONTEND=noninteractive", "FOLEVI_VERSION=${var.folevi_version}"]
    scripts = [
      "scripts/01-folevi.sh",
      "scripts/90-cleanup.sh",
      "scripts/99-img-check.sh",
    ]
  }
}
