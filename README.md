# Afterbeet — Launch Landing Page

A static waitlist landing page for the Afterbeet app launch. Plain HTML/CSS/JS,
no build step, no dependencies.

```
docs/
├── index.html   ← page content
├── styles.css   ← all styling (purple/rave theme, animations)
└── script.js    ← waitlist form handling
```

## 1. Preview it locally

Just open `docs/index.html` in your browser — double-click it. That's it.
(For a more accurate preview you can run any static server, e.g. with Python:
`python -m http.server` from the `docs/` folder, then visit `http://localhost:8000`.)

## 2. Put it live for free with GitHub Pages

1. Go to your repo on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Set **Branch** to `main` and **folder** to `/docs`, then **Save**.
4. Wait ~1 minute. Your site will be live at:
   `https://maxknight180.github.io/Beet/`

(You can later point a custom domain like `afterbeet.com` at it from the same Pages settings.)

## 3. Make the signup form actually collect emails

Right now the form runs in **demo mode** — it shows a success message but does not
store the email anywhere. To collect real signups (no backend or server needed):

1. Create a free account at **https://formspree.io** (free tier is fine to start).
2. Create a new form — it gives you an endpoint URL like
   `https://formspree.io/f/abcdwxyz`.
3. Open `docs/script.js` and paste that URL into the `FORM_ENDPOINT` value near the top:
   ```js
   const FORM_ENDPOINT = "https://formspree.io/f/abcdwxyz";
   ```
4. Commit & push. Signups now land in your Formspree inbox (and can be exported / forwarded to email).

**Alternatives to Formspree:** Mailchimp, ConvertKit, Tally, Google Forms, or
Netlify Forms (if you host on Netlify instead of GitHub Pages) all work — any of
them can replace the fetch call in `script.js`.

## Editing content

- **Headline / wording:** edit the text in `index.html`.
- **Colours / theme:** edit the CSS variables at the top of `styles.css` (`:root { ... }`).
- **Logo:** currently an animated CSS equalizer + the "Afterbeet" wordmark. Swap in
  a real logo image whenever the Afterbeet logo art is finalised.

---

## Finance Tracker

A separate app lives in [`finance-tracker/`](finance-tracker/). It's a personal
budget dashboard that links to your bank through Plaid and updates automatically
when you make a purchase. See its [README](finance-tracker/README.md) to run it.
