# NEXORA Content Plan

## Current inventory

| Collection | Count | Notes |
| --- | --- | --- |
| Knowledge articles | 23 | Windows, AD, networking, Linux, virtualization, storage, Kubernetes, backup, incident response |
| Troubleshooting checklists | 4 | Operational validation flows |
| Automation scripts | 10 | PowerShell/Bash, reviewed for safe defaults |
| Interactive tools | 28 | Local, browser-only calculators/converters |
| Reference sites | 19 | Official vendor documentation |
| News sources | 19 | Verified feeds with categories |
| AI models/presets | 12 | Provider catalog presets |

Counts are from `src/data/*.ts`. Content is static and versioned in the repository; no CMS
write path is enabled yet.

## Quality rules

1. Every article must state the symptom, scope, prerequisites, safe diagnostic sequence,
   remediation, rollback and escalation criteria.
2. Commands that change state must be labelled and include a verification step.
3. No copied vendor text. Link to the official source instead.
4. Mark version applicability (for example Windows Server 2019/2022/2025) explicitly.
5. Destructive commands must never be presented as the first step.
6. Arabic and English navigation labels stay key-identical; article bodies may be
   English-first with Arabic summaries in a later phase.
7. News items must keep the publisher, timestamp and source URL; never rewrite headlines
   into unverified claims.

## Expansion roadmap

### Phase 1 — deepen core IT operations (next)

- Windows Server update rollback and WSUS troubleshooting
- Group Policy precedence and `gpresult` interpretation
- DHCP scope exhaustion and failover recovery
- VPN site-to-site and client tunnel diagnosis
- Certificate expiry/chain failures (IIS, LDAPS, RDP)
- Entra ID Connect sync errors and hybrid identity
- Microsoft 365 mail flow and connector diagnosis
- VMware ESXi host disconnect and datastore latency
- Linux boot failure: initramfs, fstab and GRUB recovery
- PostgreSQL/MySQL connection and replication triage

### Phase 2 — security and cloud

- Least-privilege review workflow for AD and Entra roles
- Ransomware containment and backup isolation checklist
- TLS/HTTPS hardening verification
- AWS/Azure network security group drift audit
- Container image scanning and supply-chain checks
- Kubernetes RBAC and secret-handling review

### Phase 3 — automation and scripts

- Safe PowerShell remoting inventory
- Log collection bundle with redaction
- Backup restore verification automation
- Certificate expiry report
- Disk capacity forecast
- AD stale-account report (read-only)

### Phase 4 — product content

- NEXORA onboarding guide
- Provider key security guide
- Workspace and case-management playbook
- Admin role and subscription runbook
- Trial-to-premium FAQ (without inventing payment capabilities)

## Content operations

- Content is reviewed in pull requests; `content_manager` and `technical_editor` roles are
  prepared in the schema, but no content CMS endpoint is enabled in this release.
- `articles`, `content_revisions`, `news_sources`, `news_ingestion_logs` and
  `content_feedback` tables exist for a future managed workflow.
- Feedback submitted in the app is stored privately and can be resolved by staff with
  `content.update`.
- News ingestion remains on-demand with a five-minute cache; no scheduled job is enabled.

## Honest status

The knowledge base has **not** yet reached the planned expansion target. This document is
a roadmap, not a claim that the additional articles exist. New content must be technically
reviewed before publication.
