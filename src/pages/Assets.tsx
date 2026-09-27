import { useState } from "react";
import { Building2, Car, Landmark, Plus, TrendingUp, WalletCards } from "lucide-react";

type Asset = { id:string; name:string; category:string; value:number; institution:string };
const initial: Asset[] = [
  {id:"a1",name:"Savings account",category:"Bank",value:420000,institution:"HDFC Bank"},
  {id:"a2",name:"Equity portfolio",category:"Investments",value:1260000,institution:"Zerodha"},
  {id:"a3",name:"Mutual funds",category:"Investments",value:780000,institution:"AMC holdings"},
  {id:"a4",name:"Residential property",category:"Property",value:2250000,institution:"Guwahati"},
];

const icons:Record<string,any>={Bank:Landmark,Investments:TrendingUp,Property:Building2,Vehicle:Car};

export default function Assets(){
 const [assets,setAssets]=useState(initial);
 const total=assets.reduce((s,a)=>s+a.value,0);
 const add=()=>setAssets(v=>[...v,{id:String(Date.now()),name:"New asset",category:"Other",value:0,institution:""}]);
 return <div className="page">
  <div className="page-header"><div><div className="eyebrow">PERSONAL FINANCES</div><h1>My Assets</h1><p className="page-subtitle">Maintain a year-round record of assets and liabilities that can support tax preparation.</p></div><button className="btn btn-primary" onClick={add}><Plus size={16}/> Add asset</button></div>
  <div className="stat-grid"><div className="stat-card"><div className="stat-icon"><WalletCards size={19}/></div><div><div className="stat-label">Tracked assets</div><div className="stat-value">₹{(total/100000).toFixed(1)}L</div><div className="stat-note">{assets.length} records</div></div></div><div className="stat-card"><div className="stat-icon"><TrendingUp size={19}/></div><div><div className="stat-label">Investments</div><div className="stat-value">₹20.4L</div><div className="stat-note">Portfolio snapshot</div></div></div><div className="stat-card"><div className="stat-icon"><Building2 size={19}/></div><div><div className="stat-label">Property</div><div className="stat-value">₹22.5L</div><div className="stat-note">Declared value</div></div></div></div>
  <section className="panel"><div className="panel-header"><div><h2>Asset register</h2><p className="panel-subtitle">Values are user-maintained and should be supported by records when required.</p></div></div>
   <div className="table-wrap"><table className="data-table"><thead><tr><th>Asset</th><th>Category</th><th>Institution / location</th><th>Value</th></tr></thead><tbody>{assets.map(a=>{const Icon=icons[a.category]||WalletCards;return <tr key={a.id}><td><div className="cell-main"><Icon size={16}/><strong>{a.name}</strong></div></td><td>{a.category}</td><td>{a.institution}</td><td>₹{a.value.toLocaleString("en-IN")}</td></tr>})}</tbody></table></div>
  </section>
 </div>;
}
