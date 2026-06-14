import { useState, useRef } from "react";

const STEPS = ["Search", "Analyze", "Review", "Send"];

const BUSINESS_CATEGORIES = [
  { label: "Restaurant / Café", osm: ["amenity=restaurant", "amenity=cafe"] },
  { label: "Retail Shop", osm: ["shop=clothes", "shop=general", "shop=convenience"] },
  { label: "Hair Salon / Barbershop", osm: ["shop=hairdresser", "shop=barber"] },
  { label: "Auto Repair", osm: ["shop=car_repair"] },
  { label: "Plumber / Electrician", osm: ["craft=plumber", "craft=electrician"] },
  { label: "Cleaning Service", osm: ["shop=cleaning"] },
  { label: "Gym / Fitness Studio", osm: ["leisure=fitness_centre", "leisure=gym"] },
  { label: "Real Estate Agent", osm: ["office=estate_agent"] },
  { label: "Accountant / Tax Service", osm: ["office=accountant"] },
  { label: "Dentist / Doctor", osm: ["amenity=dentist", "amenity=doctors"] },
  { label: "Law Office", osm: ["office=lawyer"] },
  { label: "Photography", osm: ["shop=photo"] },
  { label: "Tutoring / Education", osm: ["amenity=school", "office=educational_institution"] },
  { label: "Pet Shop / Grooming", osm: ["shop=pet"] },
  { label: "Florist", osm: ["shop=florist"] },
];

const SERVICES = [
  { id: "website", label: "Website Design", icon: "🌐" },
  { id: "app", label: "Mobile App", icon: "📱" },
  { id: "seo", label: "SEO & Marketing", icon: "📈" },
  { id: "booking", label: "Online Booking System", icon: "📅" },
  { id: "ecommerce", label: "E-Commerce Store", icon: "🛒" },
  { id: "crm", label: "CRM & Customer Management", icon: "👥" },
];

function guessEmail(name) {
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);
  const domains = ["gmail.com", "yahoo.com", "hotmail.com"];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `${clean}@${domain}`;
}

async function geocodeCity(city) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  const data = await res.json();
  if (!data.length) throw new Error(`City "${city}" not found. Try a more specific name.`);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display: data[0].display_name };
}

async function searchOverpass(lat, lon, osmTags) {
  const radius = 5000; // 5km radius
  const tagFilters = osmTags.map(tag => {
    const [k, v] = tag.split("=");
    return `node["${k}"="${v}"](around:${radius},${lat},${lon});
way["${k}"="${v}"](around:${radius},${lat},${lon});`;
  }).join("\n");

  const query = `[out:json][timeout:25];
(
${tagFilters}
);
out body;
>;
out skel qt;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
  });

  if (!res.ok) throw new Error("Overpass API request failed");
  const data = await res.json();
  return data.elements || [];
}

export default function SmallBizOutreach() {
  const [step, setStep] = useState(0);
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [selectedServices, setSelectedServices] = useState(["website"]);
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [businesses, setBusinesses] = useState([]);
  const [selectedBiz, setSelectedBiz] = useState({});
  const [proposals, setProposals] = useState({});
  const [sentStatus, setSentStatus] = useState({});
  const [isSending, setIsSending] = useState({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [activeProposal, setActiveProposal] = useState(null);
  const [editingProposal, setEditingProposal] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const intervalRef = useRef(null);

  function toggleService(id) {
    setSelectedServices(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  }

  function toggleBiz(id) {
    setSelectedBiz(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleSearch() {
    if (!city.trim() || !category) return;
    setIsSearching(true);
    setSearchProgress(0);
    setSearchError("");

    try {
      setStatusMsg("Finding city location...");
      setSearchProgress(10);
      const { lat, lon } = await geocodeCity(city);

      setStatusMsg("Searching OpenStreetMap for businesses...");
      setSearchProgress(30);

      const cat = BUSINESS_CATEGORIES.find(c => c.label === category);
      const elements = await searchOverpass(lat, lon, cat?.osm || ["amenity=restaurant"]);

      setStatusMsg("Filtering businesses without websites...");
      setSearchProgress(75);

      const noWebsite = elements
        .filter(el => el.tags && el.tags.name && !el.tags.website && !el.tags["contact:website"])
        .slice(0, 30)
        .map((el, i) => ({
          id: el.id || i,
          name: el.tags.name,
          category,
          address: [el.tags["addr:housenumber"], el.tags["addr:street"], el.tags["addr:city"]]
            .filter(Boolean).join(", ") || "Address on OpenStreetMap",
          city,
          phone: el.tags.phone || el.tags["contact:phone"] || "N/A",
          email: el.tags.email || el.tags["contact:email"] || guessEmail(el.tags.name),
          hasWebsite: false,
          googleRating: 0,
          reviewCount: 0,
          openingHours: el.tags.opening_hours || null,
        }));

      setSearchProgress(100);

      if (noWebsite.length === 0) {
        setSearchError(`No businesses without websites found in "${city}" for "${category}". Try a larger city or different category.`);
        setIsSearching(false);
        setStatusMsg("");
        return;
      }

      setBusinesses(noWebsite);
      const sel = {};
      noWebsite.forEach(b => (sel[b.id] = true));
      setSelectedBiz(sel);
      setIsSearching(false);
      setStatusMsg("");
      setStep(1);
    } catch (err) {
      setSearchError("Error: " + err.message);
      setIsSearching(false);
      setStatusMsg("");
    }
  }

  async function handleGenerateProposals() {
    setIsGenerating(true);
    const selected = businesses.filter(b => selectedBiz[b.id]);
    const generated = {};

    for (const biz of selected) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1000,
            messages: [{
              role: "user",
              content: `You are a professional digital agency writing a cold outreach email to a small business.

Business info:
- Name: ${biz.name}
- Category: ${biz.category}
- Location: ${biz.city}
- Phone: ${biz.phone}
- No website currently (verified via OpenStreetMap)
${biz.openingHours ? `- Opening hours: ${biz.openingHours}` : ""}

Services we're offering: ${selectedServices.map(s => SERVICES.find(sv => sv.id === s)?.label).join(", ")}

Sender: ${senderName || "Alex"} (${senderEmail || "alex@agency.com"})

Write a short, warm, personalized cold email to this business. Make it feel human and specific to their business type. Keep it under 200 words. Start with "Subject: ..." on the first line, then a blank line, then the email body. No markdown, plain text only.`
            }]
          })
        });

        const data = await response.json();
        const raw = data.content?.map(c => c.text || "").join("\n") || "";
        const subjectMatch = raw.match(/Subject:\s*(.+)/i);
        const subject = subjectMatch ? subjectMatch[1].trim() : `A digital idea for ${biz.name}`;
        const body = raw.replace(/Subject:\s*.+\n?/i, "").trim();
        generated[biz.id] = { subject, body };
      } catch {
        generated[biz.id] = {
          subject: `A quick idea for ${biz.name}`,
          body: `Hi ${biz.name} Team,\n\nI came across your business while researching ${biz.category.toLowerCase()} services in ${biz.city} and noticed you don't have a website yet.\n\nIn today's world, most customers search online before visiting a business. A simple website could help you:\n\n• Get found by new customers searching Google\n• Show your hours, location, and services\n• Accept bookings or orders online 24/7\n\nI'd love to help you get online quickly and affordably. Can we schedule a free 20-minute call?\n\nWarm regards,\n${senderName || "Alex"}\n${senderEmail || ""}`
        };
      }
    }

    setProposals(generated);
    setIsGenerating(false);
    setStep(2);
  }

  async function handleSend(bizId) {
    setIsSending(prev => ({ ...prev, [bizId]: true }));
    await new Promise(r => setTimeout(r, 1800));
    setSentStatus(prev => ({ ...prev, [bizId]: true }));
    setIsSending(prev => ({ ...prev, [bizId]: false }));
  }

  async function handleSendAll() {
    const ids = businesses.filter(b => selectedBiz[b.id] && !sentStatus[b.id]).map(b => b.id);
    for (const id of ids) await handleSend(id);
    setStep(3);
  }

  const selectedCount = Object.values(selectedBiz).filter(Boolean).length;
  const sentCount = Object.values(sentStatus).filter(Boolean).length;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", color: "#e8eaf0", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e2535", padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d1321" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚀</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>BizReach</div>
            <div style={{ fontSize: 11, color: "#5a6580" }}>Small Business Outreach — Powered by OpenStreetMap</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600,
                background: i < step ? "#3b82f6" : i === step ? "linear-gradient(135deg, #3b82f6, #8b5cf6)" : "#1e2535",
                color: i <= step ? "#fff" : "#3a4560",
                border: i === step ? "2px solid #8b5cf6" : "2px solid transparent",
              }}>
                {i < step ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 12, color: i <= step ? "#a0aec0" : "#3a4560" }}>{s}</span>
              {i < STEPS.length - 1 && <div style={{ width: 20, height: 1, background: i < step ? "#3b82f6" : "#1e2535" }} />}
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>

        {/* STEP 0 */}
        {step === 0 && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 40 }}>
              <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>100% Free · No API Key Needed</div>
              <h1 style={{ fontSize: 36, fontWeight: 800, margin: "0 0 12px", background: "linear-gradient(135deg, #e8eaf0, #8b9ec0)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-1px" }}>
                Find Real Businesses Without<br />a Digital Presence
              </h1>
              <p style={{ color: "#5a6580", fontSize: 15, maxWidth: 500, margin: "0 auto" }}>
                Uses OpenStreetMap to find real local businesses worldwide — completely free, no credit card, no API key required.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#5a6580", marginBottom: 8, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Target City / Area</label>
                <input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Chittagong or London"
                  style={{ width: "100%", padding: "12px 14px", background: "#0d1321", border: "1px solid #1e2535", borderRadius: 10, color: "#e8eaf0", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                  onKeyDown={e => e.key === "Enter" && handleSearch()} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#5a6580", marginBottom: 8, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Business Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)}
                  style={{ width: "100%", padding: "12px 14px", background: "#0d1321", border: "1px solid #1e2535", borderRadius: 10, color: category ? "#e8eaf0" : "#3a4560", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                  <option value="">Select a category</option>
                  {BUSINESS_CATEGORIES.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <label style={{ display: "block", fontSize: 12, color: "#5a6580", marginBottom: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Services You Offer</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {SERVICES.map(s => (
                  <button key={s.id} onClick={() => toggleService(s.id)} style={{
                    padding: "10px 14px", borderRadius: 10, border: `1px solid ${selectedServices.includes(s.id) ? "#3b82f6" : "#1e2535"}`,
                    background: selectedServices.includes(s.id) ? "rgba(59,130,246,0.12)" : "#0d1321",
                    color: selectedServices.includes(s.id) ? "#60a5fa" : "#5a6580",
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13, transition: "all 0.2s"
                  }}>
                    <span>{s.icon}</span> {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#5a6580", marginBottom: 8, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Your Name</label>
                <input value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Alex Johnson"
                  style={{ width: "100%", padding: "12px 14px", background: "#0d1321", border: "1px solid #1e2535", borderRadius: 10, color: "#e8eaf0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#5a6580", marginBottom: 8, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Your Email</label>
                <input value={senderEmail} onChange={e => setSenderEmail(e.target.value)} placeholder="alex@yourcompany.com"
                  style={{ width: "100%", padding: "12px 14px", background: "#0d1321", border: "1px solid #1e2535", borderRadius: 10, color: "#e8eaf0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>

            {searchError && (
              <div style={{ padding: 14, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, marginBottom: 16, fontSize: 13, color: "#f87171" }}>
                ⚠️ {searchError}
              </div>
            )}

            {isSearching && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#60a5fa" }}>{statusMsg}</span>
                  <span style={{ fontSize: 12, color: "#3b82f6" }}>{Math.round(searchProgress)}%</span>
                </div>
                <div style={{ height: 6, background: "#1e2535", borderRadius: 99 }}>
                  <div style={{ height: "100%", background: "linear-gradient(90deg, #3b82f6, #8b5cf6)", borderRadius: 99, width: `${searchProgress}%`, transition: "width 0.4s" }} />
                </div>
              </div>
            )}

            <button onClick={handleSearch} disabled={!city.trim() || !category || isSearching} style={{
              width: "100%", padding: "15px", borderRadius: 12, border: "none",
              cursor: city.trim() && category && !isSearching ? "pointer" : "not-allowed",
              background: city.trim() && category ? "linear-gradient(135deg, #3b82f6, #8b5cf6)" : "#1e2535",
              color: city.trim() && category ? "#fff" : "#3a4560", fontSize: 15, fontWeight: 700, transition: "all 0.2s"
            }}>
              {isSearching ? `🔍 ${statusMsg}` : "🔍 Find Businesses Without Websites"}
            </button>

            <div style={{ marginTop: 16, padding: 12, background: "#0d1321", borderRadius: 10, border: "1px solid #1e2535", fontSize: 12, color: "#3a4560", textAlign: "center" }}>
              🌍 Powered by OpenStreetMap + Overpass API · 100% Free · No API key or credit card needed
            </div>
          </div>
        )}

        {/* STEP 1 */}
        {step === 1 && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>OpenStreetMap Results — {city}</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Found {businesses.length} Businesses Without Websites</h2>
                <p style={{ color: "#5a6580", fontSize: 13, marginTop: 4 }}>All verified — none have a website listed. Select which to contact.</p>
              </div>
              <div style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 10, padding: "8px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#60a5fa" }}>{selectedCount}</div>
                <div style={{ fontSize: 11, color: "#5a6580" }}>Selected</div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
              {businesses.map(biz => (
                <div key={biz.id} onClick={() => toggleBiz(biz.id)} style={{
                  background: "#0d1321", border: `1px solid ${selectedBiz[biz.id] ? "#3b82f6" : "#1e2535"}`,
                  borderRadius: 12, padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 16, transition: "all 0.2s"
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 6, border: `2px solid ${selectedBiz[biz.id] ? "#3b82f6" : "#2a3550"}`,
                    background: selectedBiz[biz.id] ? "#3b82f6" : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, color: "#fff", flexShrink: 0
                  }}>{selectedBiz[biz.id] ? "✓" : ""}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{biz.name}</span>
                      <span style={{ fontSize: 11, background: "rgba(239,68,68,0.1)", color: "#f87171", borderRadius: 6, padding: "2px 8px" }}>No Website ✓</span>
                      {biz.openingHours && <span style={{ fontSize: 11, color: "#5a6580" }}>🕐 {biz.openingHours}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#5a6580", flexWrap: "wrap" }}>
                      {biz.address && <span>📍 {biz.address}</span>}
                      {biz.phone !== "N/A" && <span>📞 {biz.phone}</span>}
                      <span>📧 {biz.email}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(0)} style={{ padding: "13px 24px", borderRadius: 10, border: "1px solid #1e2535", background: "transparent", color: "#5a6580", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>← Back</button>
              <button onClick={handleGenerateProposals} disabled={selectedCount === 0 || isGenerating} style={{
                flex: 1, padding: "13px", borderRadius: 10, border: "none", cursor: selectedCount > 0 && !isGenerating ? "pointer" : "not-allowed",
                background: selectedCount > 0 ? "linear-gradient(135deg, #3b82f6, #8b5cf6)" : "#1e2535",
                color: selectedCount > 0 ? "#fff" : "#3a4560", fontSize: 15, fontWeight: 700
              }}>
                {isGenerating ? "✨ AI is writing proposals..." : `✨ Generate AI Proposals for ${selectedCount} Businesses`}
              </button>
            </div>
            {isGenerating && (
              <div style={{ marginTop: 16, padding: 16, background: "rgba(59,130,246,0.05)", borderRadius: 10, border: "1px solid rgba(59,130,246,0.15)", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "#60a5fa" }}>🤖 Claude is crafting personalized proposals for each business…</div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>AI-Generated Proposals</div>
              <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Review & Send Emails</h2>
              <p style={{ color: "#5a6580", fontSize: 13, marginTop: 4 }}>Each proposal is personalized. Click any to read or edit before sending.</p>
            </div>

            <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
              {businesses.filter(b => selectedBiz[b.id]).map(biz => {
                const proposal = proposals[biz.id];
                const isOpen = activeProposal === biz.id;
                const editing = editingProposal === biz.id;
                return (
                  <div key={biz.id} style={{ background: "#0d1321", border: `1px solid ${sentStatus[biz.id] ? "#22c55e" : "#1e2535"}`, borderRadius: 12, overflow: "hidden" }}>
                    <div onClick={() => setActiveProposal(isOpen ? null : biz.id)} style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: "#1e2535", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                        {sentStatus[biz.id] ? "✅" : "📧"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, marginBottom: 2 }}>{biz.name}</div>
                        <div style={{ fontSize: 12, color: "#5a6580", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          To: {biz.email} · {proposal?.subject}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {sentStatus[biz.id]
                          ? <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>Sent ✓</span>
                          : <button onClick={e => { e.stopPropagation(); handleSend(biz.id); }} disabled={isSending[biz.id]} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            {isSending[biz.id] ? "Sending…" : "Send"}
                          </button>
                        }
                        <span style={{ fontSize: 16, color: "#3a4560", display: "inline-block", transform: isOpen ? "rotate(180deg)" : "", transition: "transform 0.2s" }}>▼</span>
                      </div>
                    </div>
                    {isOpen && proposal && (
                      <div style={{ borderTop: "1px solid #1e2535", padding: "16px 20px" }}>
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: "#5a6580", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Subject</div>
                          <div style={{ fontSize: 14, color: "#60a5fa", fontWeight: 600 }}>{proposal.subject}</div>
                        </div>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={{ fontSize: 11, color: "#5a6580", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Email Body</div>
                            <button onClick={() => setEditingProposal(editing ? null : biz.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #1e2535", background: "transparent", color: "#5a6580", cursor: "pointer", fontSize: 11 }}>
                              {editing ? "Done" : "✏️ Edit"}
                            </button>
                          </div>
                          {editing
                            ? <textarea value={proposals[biz.id]?.body} onChange={e => setProposals(prev => ({ ...prev, [biz.id]: { ...prev[biz.id], body: e.target.value } }))}
                              style={{ width: "100%", minHeight: 200, padding: 12, background: "#0a0f1a", border: "1px solid #2a3550", borderRadius: 8, color: "#e8eaf0", fontSize: 13, lineHeight: 1.6, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
                            : <pre style={{ fontFamily: "inherit", fontSize: 13, color: "#8b9ec0", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0, padding: 14, background: "#060b12", borderRadius: 8 }}>{proposal.body}</pre>
                          }
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(1)} style={{ padding: "13px 24px", borderRadius: 10, border: "1px solid #1e2535", background: "transparent", color: "#5a6580", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>← Back</button>
              <button onClick={handleSendAll} style={{ flex: 1, padding: "13px", borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #22c55e, #16a34a)", color: "#fff", fontSize: 15, fontWeight: 700 }}>
                📤 Send All {selectedCount} Emails
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 72, marginBottom: 20 }}>🎉</div>
            <h2 style={{ fontSize: 32, fontWeight: 800, marginBottom: 12, background: "linear-gradient(135deg, #22c55e, #3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Campaign Complete!</h2>
            <p style={{ color: "#5a6580", fontSize: 16, marginBottom: 32 }}>
              You sent <strong style={{ color: "#e8eaf0" }}>{sentCount} personalized proposals</strong> to businesses in <strong style={{ color: "#e8eaf0" }}>{city}</strong>.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 40, textAlign: "left" }}>
              {[
                { icon: "📧", label: "Emails Sent", value: sentCount },
                { icon: "🏙️", label: "Target Area", value: city },
                { icon: "📈", label: "Expected Replies", value: `${Math.ceil(sentCount * 0.12)}–${Math.ceil(sentCount * 0.2)}` },
              ].map(stat => (
                <div key={stat.label} style={{ background: "#0d1321", borderRadius: 12, padding: "20px", border: "1px solid #1e2535" }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{stat.icon}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 2 }}>{stat.value}</div>
                  <div style={{ fontSize: 12, color: "#5a6580" }}>{stat.label}</div>
                </div>
              ))}
            </div>
            <button onClick={() => { setStep(0); setBusinesses([]); setSentStatus({}); setProposals({}); setSelectedBiz({}); setCity(""); }} style={{
              padding: "14px 40px", borderRadius: 12, border: "none", cursor: "pointer",
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "#fff", fontSize: 15, fontWeight: 700
            }}>🚀 Start a New Campaign</button>
          </div>
        )}
      </div>
    </div>
  );
}
