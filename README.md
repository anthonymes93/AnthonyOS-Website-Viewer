# AnthonyOS Website Viewer

A lightweight **Manifest V3** extension for **Google Chrome and Vivaldi** that lets you review AnthonyOS website opportunities in **one reusable website tab**.

## Install (unpacked)

1. Download this repository as a ZIP (GitHub → **Code → Download ZIP**) and extract it.
2. In Chrome open `chrome://extensions`; in Vivaldi open `vivaldi://extensions`.
3. Enable **Developer mode**, select **Load unpacked**, and choose the extracted folder containing `manifest.json`.
4. Sign into [AnthonyOS Website Opportunities](https://autotext-psi.vercel.app/website-opportunities). Keep that CRM tab open.
5. Click **Launch Website Viewer** in the bottom-right corner, **or** click any existing **Open Website** button on the opportunity list.

The extension opens one website tab, reuses it for each subsequent site, and shows the review toolbar in the **bottom-right corner** of every supported website.

## Reviewing

- **← Previous** / **Next →** navigates through the unreviewed websites without adding more tabs.
- Select **Ugly Website**, **Good Website**, **Website Redesign Opportunity**, **AI Receptionist Opportunity**, **LeadBolt Opportunity**, or **High Value**.
- **Mark reviewed without tag** reviews a site without adding a new tag.
- When Firestore confirms a review, the CRM changes that opportunity's **reviewStatus** to `reviewed`; the viewer advances to the next unreviewed site.
- Existing tags are **preserved** and the chosen tag is appended, not duplicated.
- The extension's toolbar popup offers the same previous / next and review controls when a site is unavailable or blocks extension overlays. Click the extension icon to open it.
- Keep the **AnthonyOS CRM tab open and logged in** to save review changes. Errors do not silently remove items from the viewer.

The underlying opportunity's `status: website_detected` stays unchanged, which is intentional. Review state and tags are recorded on the same existing Firestore opportunity document used by the CRM's Website Opportunities screen.

## Architecture

- **No iframe.** Websites load as top-level browser pages, avoiding X-Frame-Options / CSP iframe refusal.
- **No extra database or backend.** Extension loads the list from the existing CRM page, and sends review requests back to that logged-in page.
- **No Firebase credentials** in the extension. The authenticated CRM page calls its existing `updateWebsiteOpportunityReview()` function.
- **One window / tab.** Background worker owns review order and a reusable tab ID, with `chrome.storage.session` preserving the working state across service-worker suspensions.
- **No automatic outreach.** Review tags do not text, email, or call leads.
- **Permissions.** All-site access is needed to put the navigation/review overlay on each visited website. `tabs` controls the reusable browser tab, `scripting` connects to the logged-in CRM, and `storage` retains the active session.

The paired CRM integration is in [`anthonymes93/autotext`](https://github.com/anthonymes93/autotext), file `src/app/desktop/views/WebsiteOpportunitiesView.tsx`. Its Vercel deployment must include the integration to enable the extension.

## Verify

Run `node --test tests/*.test.mjs` with Node.js 22+ for manifest, JavaScript syntax, session and navigation smoke tests. GitHub Actions runs them on pushes.

**Limitations:** Sites with browser-level error pages or restricted extension access may not show the in-page overlay; the extension popup remains available. This is not a screenshot service and does not proxy websites. CRM integration and a real extension session should be manually verified after install.
