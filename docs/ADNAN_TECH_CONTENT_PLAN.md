# Adnan Tech Content Plan

## Current inventory

| Collection | Count | Notes |
| --- | --- | --- |
| Knowledge articles | 44 | Windows, AD, networking, Linux, virtualization, storage, Kubernetes, backup, incident response, cloud and AI API security |
| Troubleshooting checklists | 4 | Operational validation flows |
| Automation scripts | 21 | PowerShell/Bash diagnostic templates; not executed by the platform |
| Interactive tools | 33 | Local, browser-only calculators/converters/references |
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

### Phase 1 — deepen core IT operations

Completed: Windows startup/driver/update recovery, Windows Server patch rollback, AD DNS,
DHCP diagnostics, file server and RDS triage, Microsoft 365 mail flow, SharePoint/OneDrive
sync, VPN/VLAN/Wi-Fi/packet-capture diagnostics, VMware ESXi, iSCSI/SAN, immutable backups,
Docker and AWS IAM.

Still open: Group Policy precedence and `gpresult` interpretation, Entra ID Connect sync
errors, Linux initramfs/GRUB recovery, PostgreSQL/MySQL replication triage.

### Phase 2 — security and cloud

- Least-privilege review workflow for AD and Entra roles
- Ransomware containment and backup isolation checklist
- TLS/HTTPS hardening verification
- AWS/Azure network security group drift audit
- Container image scanning and supply-chain checks
- Kubernetes RBAC and secret-handling review

### Phase 3 — automation and scripts

Completed: curated event log bundle with SHA-256 manifest, backup verification evidence,
certificate expiry report, DNS/DHCP/RDP/Windows Update diagnostics, Linux systemd
diagnostics, security baseline audit, network path diagnostics, printer inventory and
Docker diagnostics. All templates are read-only and marked `not-executed` until a
maintainer records a lab run.

Still open: automated redaction, AD stale-account report, disk capacity forecast.

### Phase 4 — product content

- Adnan Tech onboarding guide
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

The knowledge base now has **44 bilingual articles**, 21 script templates and 33 tools.
New articles link to official sources and state their scope and escalation criteria.
Scripts are read-only diagnostic templates with explicit permissions, expected output,
validation steps and a rollback note; the platform never executes them. Their `testStatus`
is `not-executed` unless a maintainer records a lab run. Remaining roadmap items above are
still open and are not claimed as complete.
