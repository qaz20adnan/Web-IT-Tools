export interface ReferenceSite {
  id: string
  name: string
  sourceType: 'official' | 'community' | 'informal'
  category: string
  search: (query: string) => string
}

const q = (query: string) => encodeURIComponent(query)

export const REFERENCE_SITES: ReferenceSite[] = [
  {
    id: 'microsoft-learn',
    name: 'Microsoft Learn',
    sourceType: 'official',
    category: 'microsoft',
    search: (query) => `https://learn.microsoft.com/en-us/search/?terms=${q(query)}`,
  },
  {
    id: 'microsoft-support',
    name: 'Microsoft Support',
    sourceType: 'official',
    category: 'microsoft',
    search: (query) => `https://support.microsoft.com/en-us/search?query=${q(query)}`,
  },
  {
    id: 'm365-docs',
    name: 'Microsoft 365 documentation',
    sourceType: 'official',
    category: 'microsoft-365',
    search: (query) => `https://learn.microsoft.com/en-us/microsoft-365/?search=${q(query)}`,
  },
  {
    id: 'cisco',
    name: 'Cisco documentation',
    sourceType: 'official',
    category: 'networking',
    search: (query) => `https://www.cisco.com/c/en/us/support/index.html#q=${q(query)}`,
  },
  {
    id: 'redhat',
    name: 'Red Hat documentation',
    sourceType: 'official',
    category: 'linux',
    search: (query) => `https://docs.redhat.com/en/search?query=${q(query)}`,
  },
  {
    id: 'ubuntu',
    name: 'Ubuntu documentation',
    sourceType: 'official',
    category: 'linux',
    search: (query) => `https://documentation.ubuntu.com/server/search/?q=${q(query)}`,
  },
  {
    id: 'vmware',
    name: 'Broadcom VMware documentation',
    sourceType: 'official',
    category: 'virtualization',
    search: (query) => `https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere.html?search=${q(query)}`,
  },
  {
    id: 'proxmox',
    name: 'Proxmox documentation',
    sourceType: 'official',
    category: 'virtualization',
    search: (query) => `https://pve.proxmox.com/wiki/index.php?search=${q(query)}`,
  },
  {
    id: 'aws',
    name: 'AWS documentation',
    sourceType: 'official',
    category: 'cloud',
    search: (query) => `https://docs.aws.amazon.com/search/doc-search.html?searchPath=documentation&searchQuery=${q(query)}`,
  },
  {
    id: 'azure',
    name: 'Microsoft Azure documentation',
    sourceType: 'official',
    category: 'cloud',
    search: (query) => `https://learn.microsoft.com/en-us/azure/?search=${q(query)}`,
  },
  {
    id: 'gcp',
    name: 'Google Cloud documentation',
    sourceType: 'official',
    category: 'cloud',
    search: (query) => `https://cloud.google.com/s/results?q=${q(query)}`,
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes documentation',
    sourceType: 'official',
    category: 'devops',
    search: (query) => `https://kubernetes.io/search/?q=${q(query)}`,
  },
  {
    id: 'github',
    name: 'GitHub',
    sourceType: 'community',
    category: 'code',
    search: (query) => `https://github.com/search?q=${q(query)}&type=issues`,
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    sourceType: 'community',
    category: 'code',
    search: (query) => `https://stackoverflow.com/search?q=${q(query)}`,
  },
  {
    id: 'serverfault',
    name: 'Server Fault',
    sourceType: 'community',
    category: 'sysadmin',
    search: (query) => `https://serverfault.com/search?q=${q(query)}`,
  },
  {
    id: 'reddit',
    name: 'Reddit (practitioner experience)',
    sourceType: 'informal',
    category: 'community',
    search: (query) => `https://www.reddit.com/search/?q=${q(query)}`,
  },
  {
    id: 'nvd',
    name: 'NIST NVD (vulnerabilities)',
    sourceType: 'official',
    category: 'security',
    search: (query) => `https://nvd.nist.gov/vuln/search/results?query=${q(query)}&search_type=all`,
  },
  {
    id: 'msrc',
    name: 'Microsoft Security Response Center',
    sourceType: 'official',
    category: 'security',
    search: (query) => `https://msrc.microsoft.com/update-guide/vulnerability?search=${q(query)}`,
  },
  {
    id: 'cisa',
    name: 'CISA',
    sourceType: 'official',
    category: 'security',
    search: (query) => `https://www.cisa.gov/search?g=${q(query)}`,
  },
]
