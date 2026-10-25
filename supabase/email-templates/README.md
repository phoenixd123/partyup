# PartyUp email templates

Paste these into **Supabase → Authentication → Emails → Templates**:

| Template | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `Welcome to PartyUp — your code is {{ .Token }}` |
| Reset password | `reset-password.html` | `Your PartyUp reset code: {{ .Token }}` |
| Change email address | `change-email.html` | `Confirm your new PartyUp email` |

Each email shows the code (`{{ .Token }}`) in large type, which the app accepts on the
"Check your email" screen, plus a one-click button (`{{ .ConfirmationURL }}`) that reopens
the desktop app through `partyup://auth-callback`. The button only works once **Site URL** /
**Redirect URLs** are set as described in the main README.

Supabase's built-in email service only delivers to your project team's addresses. For real
users, add a custom SMTP sender under **Authentication → Emails → SMTP Settings**.
