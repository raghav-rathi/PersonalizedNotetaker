// The kinds of session, as the start screen's Mode and AI Context's Profile list them.
export const PROFILES = [
    { value: 'interview', label: 'Job Interview' },
    { value: 'coding', label: 'Coding Round (DSA)' },
    { value: 'lld', label: 'LLD Interview (SDE-2)' },
    { value: 'hld', label: 'HLD / System Design' },
    { value: 'devops', label: 'DevOps / SRE Round' },
    { value: 'sales', label: 'Sales Call' },
    { value: 'meeting', label: 'Tech Meeting' },
    { value: 'presentation', label: 'Presentation' },
    { value: 'negotiation', label: 'Negotiation' },
    { value: 'exam', label: 'Exam Assistant' },
];

export const PROFILE_NAMES = Object.fromEntries(PROFILES.map(({ value, label }) => [value, label]));
