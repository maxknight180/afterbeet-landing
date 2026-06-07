// Afterbeet landing page — waitlist signup handling
//
// HOW TO ACTIVATE EMAIL CAPTURE:
// 1. Create a free form at https://formspree.io (or use Mailchimp/ConvertKit, etc.)
// 2. Copy your form's endpoint URL and paste it into FORM_ENDPOINT below.
// Until you do, the form will run in DEMO mode: it validates the email and shows
// a success message, but does NOT store the address anywhere.

const FORM_ENDPOINT = ""; // e.g. "https://formspree.io/f/abcdwxyz"

const form = document.getElementById("waitlist-form");
const emailInput = document.getElementById("email");
const msg = document.getElementById("form-msg");
const submitBtn = form.querySelector(".submit-btn");

// footer year
document.getElementById("year").textContent = new Date().getFullYear();

function setMessage(text, type) {
  msg.textContent = text;
  msg.className = "form-msg" + (type ? " " + type : "");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();

  if (!isValidEmail(email)) {
    setMessage("Please enter a valid email address.", "error");
    emailInput.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Joining…";

  // DEMO mode — no endpoint configured yet
  if (!FORM_ENDPOINT) {
    await new Promise((r) => setTimeout(r, 600));
    setMessage("🎉 You're on the list! (Demo mode — set FORM_ENDPOINT in script.js to store emails.)", "success");
    form.reset();
    submitBtn.disabled = false;
    submitBtn.textContent = "Join the waitlist";
    return;
  }

  // LIVE mode — send to your form service
  try {
    const res = await fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (res.ok) {
      setMessage("🎉 You're on the list! See you on the dancefloor.", "success");
      form.reset();
    } else {
      setMessage("Something went wrong — please try again.", "error");
    }
  } catch (err) {
    setMessage("Network error — please try again.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Join the waitlist";
  }
});
