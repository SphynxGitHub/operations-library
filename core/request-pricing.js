//======================= CORE / REQUEST PRICING =======================//
// A request can cover more than one resource (real ones, or "shell" resources that stand in for what is going to
// be built). The request's fee is the total of its resources' fees, and the team multiplier and any discount apply
// once, to the request. Each resource is priced by its own type's variables and its own units, set on the resource
// itself. Time-based work (a meeting, training, an audit) is priced by hours, as before.
//
// This is the same arithmetic the scoping sheet has always used for a single resource, so a request with one
// resource comes out to exactly the same fee. Pure functions: no page, no database.
//
//   item.resourceId    the request's main resource (kept, so everything that already reads it keeps working)
//   item.resourceIds   the request's resources in order, main one first
//   item.data          units set on the line itself; these apply to the main resource only (older sheets)
//   item.manualHours   estimated hours: the fee only when NO resource has priced units

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// The resource ids on a request: the main one first, then any others, without repeats.
export function requestResourceIds(item) {
    if (!item) return [];
    const out = [];
    [item.resourceId, ...(Array.isArray(item.resourceIds) ? item.resourceIds : [])].forEach((id) => {
        if (!isBlank(id) && !out.includes(String(id))) out.push(String(id));
    });
    return out;
}

// The multiplier for the number of people on the work: 1 + (people - 1) x (rate - 1), unless the line is global.
export function teamMultiplier(item, { rate, teamCount } = {}) {
    const mode = String(item?.teamMode || 'everyone').toLowerCase();
    if (mode === 'global') return 1;
    const perPerson = (parseFloat(rate) || 1.1) - 1;
    const count = mode === 'individual' ? (item?.teamIds || []).length : (teamCount || 1);
    return 1 + Math.max(0, count - 1) * perPerson;
}

// One resource's priced units: what its own type charges for, from its units.
function pricedUnits(resource, unitOverrides, vars) {
    const data = { ...(resource?.data || {}), ...(unitOverrides || {}) };
    const units = [];
    Object.entries(data).forEach(([varId, count]) => {
        const v = vars?.[varId];
        const n = parseFloat(count) || 0;
        if (v && n > 0 && v.applyTo === resource?.type) units.push({ id: varId, label: v.label || varId, count: n, value: parseFloat(v.value) || 0 });
    });
    return units;
}

// resources: the request's resources in order (main first). ctx: { vars, baseRate, multiplier }
// Returns { gross, lines: [{ resourceId, name, type, isShell, units, fee }], hours, hoursFee, multiplier }.
// Each line's fee is rounded on its own, so the lines add up exactly to the request's fee.
export function priceRequest(item, resources, ctx = {}) {
    const vars = ctx.vars || {};
    const multiplier = ctx.multiplier ?? 1;
    const list = (resources || []).filter(Boolean);
    const lines = list.map((res, i) => {
        const units = pricedUnits(res, i === 0 ? item?.data : null, vars);
        const base = units.reduce((sum, u) => sum + u.count * u.value, 0);
        return { resourceId: String(res.id), name: res.name || '', type: res.type || '', isShell: !!res.isShell, units, base, fee: Math.round(base * multiplier) };
    });
    const anyUnits = lines.some((l) => l.units.length > 0);
    const hours = parseFloat(item?.manualHours) || 0;
    const hoursFee = anyUnits ? 0 : Math.round(hours * (ctx.baseRate || 0) * multiplier);
    const gross = lines.reduce((sum, l) => sum + l.fee, 0) + hoursFee;
    return { gross, lines: lines.map(({ base, ...rest }) => rest), hours, hoursFee, multiplier, hasUnits: anyUnits };
}

// The resources of a request as they appear on the client's printed sheet: each with its own price (its units
// and its fee), and the hours when the request is priced by time. Empty for a request with only one resource,
// which prints as it always has. esc escapes text for the page.
export function renderRequestResourcesHtml(breakdown, esc = (s) => String(s ?? '')) {
    if (!breakdown || breakdown.lines.length < 2) return '';
    const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
    const rows = breakdown.lines.map((l) => {
        const units = l.units.map((u) => `${u.count} ${esc(u.label)}`).join(' · ');
        return `<div class="res-line"><span class="res-name">${esc(l.name)}${l.type ? ` <span class="res-type">${esc(l.type)}</span>` : ''}${units ? ` <span class="res-units">${units}</span>` : ''}</span><span class="res-fee">${money(l.fee)}</span></div>`;
    });
    if (breakdown.hoursFee > 0) rows.push(`<div class="res-line"><span class="res-name">Estimated time <span class="res-units">${breakdown.hours} hour${breakdown.hours === 1 ? '' : 's'}</span></span><span class="res-fee">${money(breakdown.hoursFee)}</span></div>`);
    return `<div class="res-lines">${rows.join('')}</div>`;
}

export const REQUEST_RESOURCES_CSS = `
.res-lines { margin-top: 5px; border-top: 1px dashed #e2e8f0; padding-top: 3px; }
.res-line { display: flex; justify-content: space-between; gap: 14px; padding: 2px 0; font-size: 9px; color: #334155; }
.res-name { flex: 1; }
.res-type { font-size: 8px; font-weight: 700; text-transform: uppercase; border: 1px solid #e2e8f0; border-radius: 3px; padding: 0 5px; color: #475569; margin-left: 4px; }
.res-units { color: #94a3b8; margin-left: 6px; }
.res-fee { font-variant-numeric: tabular-nums; font-weight: 700; color: #0f172a; white-space: nowrap; }`;
