
/**
 * Generates a display ID based on prefix and timestamp (YYMMDDHHmmss).
 * @param {string} prefix - The prefix (e.g., 'RS_', 'CS_').
 * @param {Date|Object|string} timestamp - The timestamp source. Defaults to current time.
 * @returns {string} The generated ID.
 */
export function generateDisplayId(prefix, timestamp) {
    let date = new Date(); // Default to now
    if (timestamp) {
        if (typeof timestamp.toDate === 'function') {
            date = timestamp.toDate();
        } else if (timestamp.seconds) {
            date = new Date(timestamp.seconds * 1000);
        } else {
            const parsed = new Date(timestamp);
            if (!isNaN(parsed.getTime())) date = parsed;
        }
    }

    const yy = String(date.getFullYear()).slice(-2);
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const HH = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');

    return `${prefix}${yy}${MM}${dd}${HH}${mm}${ss}`;
}
