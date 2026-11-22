# AnthonyOS Website Viewer

Chrome / Vivaldi extension for reviewing website opportunities in the existing AnthonyOS CRM.

Load unpacked in `chrome://extensions` or `vivaldi://extensions` after files are available. Visit your logged-in CRM at `https://autotext-psi.vercel.app/website-opportunities` and click **Launch Viewer**.

The viewer uses a normal browser tab instead of iframes, preserving compatibility with websites that reject embedding. Its toolbar navigates among the unreviewed items, applies existing CRM tags, and marks them reviewed through the CRM page's authenticated Firestore connection. The extension never stores Firebase credentials or connects directly to the database.
