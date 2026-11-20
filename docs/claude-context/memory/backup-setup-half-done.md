---
name: backup-setup-half-done
description: Folevi off-platform backup is half set up (as of 2026-11-17); three GitHub secrets still missing
metadata:
  node_type: memory
  type: project
  originSessionId: 268f5a8a-585a-47a3-bd85-16826be58f9a
  modified: 2026-11-17T03:52:23.633Z
---

On 2026-11-16 the backup setup (docs/DEPLOYMENT.md "Backups and restore", .github/workflows/backup.yml) was partly done:
- age key pair: private key at ~/Desktop/folevi-backup.key (owner to move it to a password manager); public key set as GitHub variable BACKUP_AGE_RECIPIENT.
- R2 bucket folevi-backups created (Cloudflare account ce348fe6…), lock rules daily/ 30 d and monthly/ 365 d, lifecycle expiry 31 d and 366 d.
- GitHub variables BACKUP_R2_BUCKET and BACKUP_R2_ENDPOINT set.

Still missing: secrets BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY (R2 token, Object Read & Write on folevi-backups only) and BACKUP_CONVEX_DEPLOY_KEY (production fastidious-clownfish-123). The owner deferred these on 2026-11-17.

**Why:** the Backup workflow fails daily until all six settings exist.

**How to apply:** when the owner returns to it, they add the secrets with `gh secret set` (Claude never handles the values), then run the workflow by hand with `gh workflow run backup.yml` and confirm an object lands in folevi-backups/daily/.
