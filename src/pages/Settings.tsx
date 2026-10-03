import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Database, KeyRound, LockKeyhole, Save, SlidersHorizontal, UserRound } from "lucide-react";
import { Badge, Button, PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import "../individual.css";

const adminDefaults = [
  ["Evidence-first responses", "Require source / calculation blocks for supported workflows"],
  ["Professional review notices", "Show review warnings for high-impact outputs"],
  ["Organization knowledge", "Allow authorized agents to use internal knowledge base"],
  ["Streaming responses", "Stream assistant output into chat"],
];
const personalNotifications = [
  ["ITR preparation reminders", "Reminders for return preparation and review"],
  ["Document updates", "Updates when tax records are added or processed"],
  ["Account security alerts", "Important sign-in and account notices"],
];

export default function Settings() {
  const { user, updateAccount, changePassword } = useAuth();
  const [name,setName]=useState(user?.name||"");
  const [email,setEmail]=useState(user?.email||"");
  const [phone,setPhone]=useState(user?.phone||"");
  const [currentPassword,setCurrentPassword]=useState("");
  const [newPassword,setNewPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);

  useEffect(()=>{setName(user?.name||"");setEmail(user?.email||"");setPhone(user?.phone||"");},[user]);

  const saveAccount=async(e:FormEvent)=>{
    e.preventDefault();setMessage("");setError("");setSaving(true);
    try{await updateAccount({name,email,phone});setMessage("Account details updated successfully.");}
    catch(err){setError(err instanceof Error?err.message:"Unable to update account.");}
    finally{setSaving(false);}
  };
  const savePassword=async(e:FormEvent)=>{
    e.preventDefault();setMessage("");setError("");
    if(newPassword!==confirmPassword){setError("New passwords do not match.");return;}
    setSaving(true);
    try{await changePassword(currentPassword,newPassword);setCurrentPassword("");setNewPassword("");setConfirmPassword("");setMessage("Password changed successfully.");}
    catch(err){setError(err instanceof Error?err.message:"Unable to change password.");}
    finally{setSaving(false);}
  };

  const accountPanel=(
    <section className="panel">
      <div className="panel-head"><div><h2>Account details</h2><p>Update the personal details used by your FinPro account.</p></div><UserRound size={18}/></div>
      <form onSubmit={saveAccount} className="form-grid">
        <label>Full name<input value={name} onChange={e=>setName(e.target.value)} autoComplete="name" required /></label>
        <label>Email address<input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="email" required /></label>
        <label>Mobile number<input value={phone} onChange={e=>setPhone(e.target.value)} type="tel" autoComplete="tel" placeholder="+91 98765 43210" /></label>
        <label>Account type<input value={user?.role||""} readOnly /></label>
        {user?.role==="Professional User" && <label>Professional role<input value={user.professionalRole} readOnly /></label>}
        <label>Organization<input value={user?.organizationName||""} readOnly /></label>
        <div style={{gridColumn:"1 / -1",display:"flex",justifyContent:"flex-end"}}><Button type="submit" disabled={saving}><Save size={15}/>{saving?"Saving...":"Save account"}</Button></div>
      </form>
    </section>
  );

  const passwordPanel=(
    <section className="panel">
      <div className="panel-head"><div><h2>Change password</h2><p>Use your current password to set a new password of at least 8 characters.</p></div><KeyRound size={18}/></div>
      <form onSubmit={savePassword} className="form-grid">
        <label>Current password<input type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} autoComplete="current-password" required /></label>
        <label>New password<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
        <label>Confirm new password<input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
        <div style={{gridColumn:"1 / -1",display:"flex",justifyContent:"flex-end"}}><Button type="submit" disabled={saving}><LockKeyhole size={15}/>Change password</Button></div>
      </form>
    </section>
  );

  return user?.role==="Individual" ? (
    <div className="individual-settings">
      <PageHeader eyebrow="PERSONAL ACCOUNT" title="Settings" description="Manage your personal account, reminders and tax workspace." />
      {message&&<div className="success-box">{message}</div>}{error&&<div className="notice"><strong>{error}</strong></div>}
      {accountPanel}{passwordPanel}
      <div className="settings-grid">
        <section className="panel"><div className="panel-head"><div><h2>Personal notifications</h2><p>Updates for your tax preparation workflow.</p></div><Bell size={18}/></div>
          {personalNotifications.map(([title,description])=><label className="setting-row" key={title}><div><strong>{title}</strong><span>{description}</span></div><input type="checkbox" defaultChecked/></label>)}
        </section>
        <section className="panel"><div className="panel-head"><div><h2>Tax workspace</h2><p>Personal records used to prepare your return.</p></div><Database size={18}/></div>
          <div className="list-row"><div><strong>Assets &amp; liabilities</strong><span>Maintain current records for tax preparation.</span></div><Link className="text-link" to="/assets">Open</Link></div>
          <div className="list-row"><div><strong>Tax documents</strong><span>Review supporting records in your workspace.</span></div><Link className="text-link" to="/documents">Open</Link></div>
          <div className="list-row"><div><strong>Income tax return</strong><span>Continue preparation and review.</span></div><Link className="text-link" to="/itr-filing">Open</Link></div>
        </section>
        <section className="panel"><div className="panel-head"><div><h2>Filing &amp; privacy</h2><p>Preparation remains reviewable and account-scoped.</p></div><SlidersHorizontal size={18}/></div>
          <div className="notice"><div><strong>Human review remains important</strong><span>Check source documents and tax calculations before relying on a return.</span></div></div>
        </section>
      </div>
    </div>
  ) : (
    <>
      <PageHeader eyebrow="ACCOUNT & CONFIGURATION" title="Settings" description="Manage your account, security, organization settings, AI defaults and notifications." />
      {message&&<div className="success-box">{message}</div>}{error&&<div className="notice"><strong>{error}</strong></div>}
      {accountPanel}{passwordPanel}
      <div className="settings-grid">
        <section className="panel"><div className="panel-head"><div><h2>AI &amp; workflow defaults</h2><p>Control how assistants behave within authorized projects.</p></div><SlidersHorizontal size={18}/></div>
          {adminDefaults.map(([title,description],index)=><label className="setting-row" key={title}><div><strong>{title}</strong><span>{description}</span></div><input type="checkbox" defaultChecked={index!==3}/></label>)}
        </section>
        <section className="panel"><div className="panel-head"><div><h2>Security</h2><p>Backend-controlled account security.</p></div><LockKeyhole size={18}/></div>
          {["Session timeout","MFA readiness","API rate limits","Secure file access"].map(item=><div className="list-row" key={item}><div><strong>{item}</strong><span>Backend-controlled setting</span></div><Badge tone="success">Configured</Badge></div>)}
        </section>
        <section className="panel"><div className="panel-head"><div><h2>Notifications</h2><p>Task, document, report and compliance events.</p></div><Bell size={18}/></div>
          {["Task assignments","Document processing","AI report completion","Compliance reminders"].map(item=><div className="list-row" key={item}><div><strong>{item}</strong><span>Email + in-app</span></div><input type="checkbox" defaultChecked/></div>)}
        </section>
        <section className="panel"><div className="panel-head"><div><h2>Data architecture</h2><p>Service layer prepared for backend integrations.</p></div><Database size={18}/></div>
          <div className="architecture-list"><div>Frontend</div><span>→</span><div>Backend API</div><span>→</span><div>Document Processing</div><span>→</span><div>Retrieval / AI Validation</div></div>
        </section>
      </div>
    </>
  );
}
