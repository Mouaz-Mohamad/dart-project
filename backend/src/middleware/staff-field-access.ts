import type { RequestHandler } from "express";
export function canReadCosts(permissions: readonly string[]): boolean {
    return ["finance.read", "finance.manage", "finance.view_cost"].some(key => permissions.includes(key));
}
const costFields = new Set(["cost", "costminor", "costsnapshot", "costsnapshotminor", "costtotalminor",
    "totalcost", "totalcostminor", "unitcostminor", "acquisitioncost", "acquisitioncostminor"]);
const profitFields = new Set(["margin", "marginvscostminor", "belowcost", "profit", "netprofit", "grossprofit"]);
const buyerFields = new Set(["clientname", "clientid", "clientcode", "phone", "phone1", "phone2", "email", "customername", "customerid"]);
function project(value: unknown, costs: boolean, profit: boolean, buyers: boolean): unknown {
    if (Array.isArray(value))
        return value.map(row => project(row, costs, profit, buyers));
    if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
        return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => {
        const name = key.replaceAll("_", "").toLowerCase();
        return (costs || !costFields.has(name)) && (profit || !profitFields.has(name)) && (buyers || !buyerFields.has(name));
    }).map(([key, current]) => [key, project(current, costs, profit, buyers)]));
}
// Apply to reads and command responses, including legacy/audit snapshots.
export const staffFieldAccess: RequestHandler = (request, response, next) => {
    const json = response.json;
    response.json = function (body: unknown) {
        if (!/^\/api\/v1\/admin(?:\/|\?|$)/i.test(request.originalUrl) || request.auth?.accountType !== "staff")
            return json.call(this, body);
        const permissions = request.auth.permissions;
        const catalog = /^\/api\/v1\/admin\/catalog-state(?:\/|\?|$)/i.test(request.originalUrl);
        const audit = /^\/api\/v1\/admin\/audit(?:\/|\?|$)/i.test(request.originalUrl);
        const costs = canReadCosts(permissions);
        const profit = ["finance.read", "finance.manage", "finance.view_profit"].some(key => permissions.includes(key));
        // Order/contact permissions have their own purpose; private catalog reads need
        // an explicit customer grant before attaching a buyer's identity to inventory.
        const buyers = !(catalog || audit) || permissions.includes("customers.read");
        if (costs && profit && buyers)
            return json.call(this, body);
        return json.call(this, project(body, costs, profit, buyers));
    };
    next();
};
