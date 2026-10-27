/** One-tap starting points for notes people keep forgetting to write down. Plain markdown, plain tags: a template is only a head start. */
export interface NoteTemplate { id: string; icon: string; name: string; type: string; tags: string[]; title: string; body: string }

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "appliance", icon: "📋", name: "Appliance spec and manual", type: "fact", tags: ["home", "appliance"], title: "Appliance: ",
    body: "# Appliance\n\n- Brand and model number: \n- Serial number: \n- Filter or part size: \n- Purchased on: \n- Warranty until: \n- Warranty or repair phone: \n- Where the manual is: \n\n## Notes\n",
  },
  {
    id: "vehicle", icon: "🚗", name: "Vehicle service record", type: "fact", tags: ["vehicle"], title: "Vehicle: ",
    body: "# Vehicle\n\n- Make, model, year: \n- Oil type and amount: \n- Tire size and pressure: \n- Last oil change (date and mileage): \n- Next service due: \n- Insurance policy number location: \n\n## Service history\n- \n",
  },
  {
    id: "doctor", icon: "🩺", name: "Doctor visit briefing", type: "fact", tags: ["health"], title: "Doctor visit: ",
    body: "# Doctor visit\n\n> Keep this to what you need for the visit. Anything here can be read by an AI you have allowed to see your notes.\n\n## What has been happening (dates help)\n- \n\n## Current medications\n- \n\n## Questions to ask\n- [ ] \n- [ ] \n\n## What the doctor said\n",
  },
  {
    id: "trip", icon: "✈️", name: "Trip itinerary planner", type: "fact", tags: ["travel"], title: "Trip: ",
    body: "# Trip\n\n- Dates: \n- Where we are staying: \n- Confirmation numbers location: \n\n## Day by day\n### Day 1\n- \n### Day 2\n- \n\n## Packing list\n- [ ] \n- [ ] \n",
  },
  {
    id: "bills", icon: "🧾", name: "Subscription and bill audit", type: "fact", tags: ["money", "bills"], title: "Bills and subscriptions",
    body: "# Bills and subscriptions\n\n| What | Cost per month | Renews on | How to cancel | Shared with |\n| --- | --- | --- | --- | --- |\n|  |  |  |  |  |\n\n## Notes\n",
  },
  {
    id: "emergency", icon: "🚨", name: "Emergency action card", type: "fact", tags: ["home", "emergency"], title: "Emergency card",
    body: "# Emergency card\n\n- Water main shut-off is: \n- Electrical panel and breaker notes: \n- Gas shut-off is: \n- Emergency contacts: \n- Insurance company and where the policy numbers are kept: \n\n> Write where the policy numbers are kept, not the numbers themselves.\n",
  },
];

export const BLANK_TEMPLATE: NoteTemplate = { id: "blank", icon: "📄", name: "Blank note", type: "fact", tags: [], title: "", body: "" };
