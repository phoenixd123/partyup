// PartyUp Tournament Agreement. Everyone accepts it to host or enter a tournament,
// and the version they accepted is stored with their entry (tournament_agreements).
// If you change the text, bump AGREEMENT_VERSION here AND tournament_agreement_version()
// in supabase/schema.sql so everyone re-accepts the new terms.
//
// This is a plain-language template, not legal advice. Have a lawyer review it for
// the places you operate in before relying on it for real-money prizes.
export const AGREEMENT_VERSION = 1;
export const AGREEMENT_UPDATED = 'October 2026';

export const AGREEMENT_SECTIONS = [
  {
    title: '1. What this agreement covers',
    body: [
      'This agreement applies to every tournament created on PartyUp, between the tournament host, every player who enters, and PartyUp. By hosting or entering a tournament you agree to it.',
      'PartyUp provides the tools (sign-ups, brackets, result reporting, chat and moderation). PartyUp does not organize, sponsor, or guarantee any tournament, and is not a party to any prize arrangement between a host and players.',
    ],
  },
  {
    title: '2. No entry fees, buy-ins or gambling',
    body: [
      'Tournaments on PartyUp are free to enter. Hosts must not ask for, accept or arrange any entry fee, buy-in, deposit, "registration fee", wager, or payment of any kind from players — on PartyUp or anywhere else.',
      'Betting on matches is not allowed. Any request for money from a host to a player is a violation of this agreement and should be reported.',
    ],
  },
  {
    title: '3. Prizes are the host\'s responsibility',
    body: [
      'If a host offers a prize, the host alone promises to deliver it, using the payout method and within the number of days shown on the tournament page. PartyUp never holds, transfers or insures prize money or items.',
      'Hosts must only offer prizes they actually have and are allowed to give. Prizes cannot be changed or reduced after registration opens, except to increase them.',
      'Winners are responsible for any taxes or reporting that apply to prizes they receive. Hosts may need to collect details required by law (for example for tax forms) — share only what is necessary, and never your passwords or full card numbers.',
      'PartyUp shows each host\'s public record: tournaments hosted and completed, prizes confirmed received, and prizes reported unpaid. Unpaid prize reports are sent to PartyUp moderators automatically. Hosts with unpaid prize reports can be blocked from hosting prize tournaments and their accounts can be suspended or banned.',
    ],
  },
  {
    title: '4. Eligibility',
    body: [
      'You must follow PartyUp\'s rules and the game publisher\'s terms of service, including any rules about tournaments or prizes for that game.',
      'You must meet any minimum age and residency requirements for prize competitions where you live. Prize tournaments may be void where prohibited. If you are under the age of majority where you live, you need a parent or guardian\'s permission to receive a prize.',
      'Hosts may not enter their own tournaments. Every member of a team must agree to this agreement through their own PartyUp account.',
    ],
  },
  {
    title: '5. Fair play',
    body: [
      'No cheating, hacks, exploits, account sharing, smurfing to dodge brackets, match fixing, or harassment. Play with the account and rank you registered with.',
      'Team captains report match results honestly. If captains report different winners the match is marked disputed and the host decides, based on evidence like screenshots or recordings. Keep evidence until the tournament is over.',
      'The host may disqualify players who break the posted rules or this agreement, and must explain why. Disqualified players can report the host if they believe the decision was abusive.',
    ],
  },
  {
    title: '6. Hosts\' duties',
    body: [
      'Post clear rules, a start time, the bracket size, the prize (if any), how and when prizes will be paid, and a way to contact you.',
      'Run the tournament in good faith, resolve disputes fairly, and mark prizes as sent only once they actually are. If you have to cancel, cancel on PartyUp and tell entrants why.',
    ],
  },
  {
    title: '7. Your information',
    body: [
      'Your username, team name, results and placement are shown publicly on the tournament page. Do not share personal information about other players. Payout details should be exchanged privately and only as needed.',
    ],
  },
  {
    title: '8. Reporting and moderation',
    body: [
      'Report scams, unpaid prizes, cheating or abuse with the Report button on the tournament page. PartyUp moderators may remove tournaments, cancel results, and suspend or ban accounts that break this agreement. PartyUp does not recover money or items on anyone\'s behalf, but may share relevant information with law enforcement where required by law.',
    ],
  },
  {
    title: '9. Limits of PartyUp\'s responsibility',
    body: [
      'PartyUp is provided "as is". To the fullest extent allowed by law, PartyUp is not responsible for prizes, for the conduct of hosts or players, or for losses from a tournament, and PartyUp\'s total liability related to any tournament is limited to the amount you paid PartyUp for it (which is zero — tournaments are free).',
      'Nothing in this agreement limits rights you have under consumer protection laws that can\'t be waived.',
    ],
  },
  {
    title: '10. Changes',
    body: [
      'If this agreement changes, you\'ll be asked to accept the new version before hosting or entering another tournament. The version you accepted stays recorded with each tournament you took part in.',
    ],
  },
];
