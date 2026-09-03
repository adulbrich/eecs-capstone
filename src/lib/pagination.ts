/**
 * The one page-size bound for every paginated list.
 *
 * The public endpoints are anonymous and the client picks `pageSize`, so the
 * server has to bound it, and one number here beats three schemas each with
 * their own. Every route asks for the default; nothing asks for more, so the
 * cap only exists to refuse a hand-written request (#209).
 */
export const PAGE_SIZE_MAX = 50;
export const PAGE_SIZE_DEFAULT = 20;
