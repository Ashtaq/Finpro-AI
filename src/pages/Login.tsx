import { FormEvent,useState } from "react";
import { Link,useNavigate } from "react-router-dom";
import { ShieldCheck,Sparkles } from "lucide-react";
import { useAuth,DEMO_ACCOUNTS } from "../context/AuthContext";
import { Role } from "../types";
export default function Login(){
 const navigate=useNavigate();const {login}=useAuth();const [role,setRole]=useState<Role>("Finance User");const [email,setEmail]=useState("finance@finotech.demo");const [password,setPassword]=useState("demo123");const [show,setShow]=useState(false);const [error,setError]=useState("");
 const submit=async(e:FormEvent)=>{e.preventDefault();setError("");try{await login(email,password,role);navigate(role==="Individual"?"/individual":"/");}catch(err){setError(err instanceof Error?err.message:"Login failed");}};
 const pickDemo=(selected:Role)=>{setRole(selected);const account=DEMO_ACCOUNTS.find(a=>a.role===selected);if(account)setEmail(account.email);if(selected==="Individual"){setEmail("individual@finotech.demo");setPassword("demo123");}};
 return <div className="auth-shell"><div className="auth-brand"><div className="brand-mark large"><Sparkles size={22}/></div><div><div className="brand-name">FINOTECH</div><div className="brand-sub">AI FINANCE OS</div></div></div><div className="auth-card">
 <div className="auth-icon"><ShieldCheck size={23}/></div><div className="eyebrow">SECURE WORKSPACE</div><h1>Sign in to Finotech AI</h1><p className="auth-muted">Choose the workspace that matches how you use Finpro.</p>
 <form onSubmit={submit} className="form-stack"><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" required/></label><label>Password<div className="password-wrap"><input value={password} onChange={e=>setPassword(e.target.value)} type={show?"text":"password"} required/><button type="button" onClick={()=>setShow(!show)}>{show?"Hide":"Show"}</button></div></label>
 <div className="role-picker">{(["Individual","Finance User","Admin","Super Admin"] as Role[]).map(r=><button type="button" key={r} className={role===r?"role-chip selected":"role-chip"} onClick={()=>pickDemo(r)}>{r}</button>)}</div>
 {error&&<div className="error-box">{error}</div>}<button className="btn btn-primary wide" type="submit">Sign in</button></form>
 <div className="auth-divider">or</div><Link to="/signup" className="btn btn-secondary wide">Create an account</Link>
 <div className="demo-note"><strong>Demo:</strong> Individual demo uses the local Phase 2 Individual API.</div></div><div className="auth-footer">Finance professionals and self-filing individuals in one secure platform.</div></div>;
}