export const organizations=[
{id:"org-1",name:"Meridian Advisory LLP",plan:"Business",users:28,activeProjects:42,documentsProcessed:1284,aiRequests:7420},
{id:"org-2",name:"Northstar Finance Partners",plan:"Professional",users:12,activeProjects:16,documentsProcessed:492,aiRequests:2398},
{id:"org-3",name:"Vertex Corporate Services",plan:"Enterprise",users:76,activeProjects:98,documentsProcessed:3210,aiRequests:18210}
];
export const demoUsers=[
{id:"u-finance",name:"Riya Sharma",email:"finance@finotech.demo",role:"Finance User",professionalRole:"Other",organizationId:"org-1",organizationName:"Meridian Advisory LLP"},
{id:"u-professional",name:"Aarav Mehta",email:"professional@finotech.demo",role:"Professional User",professionalRole:"CA",organizationId:"org-1",organizationName:"Meridian Advisory LLP"},
{id:"u-individual",name:"Individual Demo",email:"individual@finotech.demo",role:"Individual",professionalRole:"Other",organizationId:"individual-demo",organizationName:"Individual Demo Workspace"}
];
export const clients=[
{id:"c-1",name:"Rahul Kapoor",company:"Aster Manufacturing Pvt Ltd",industry:"Manufacturing",email:"rahul@aster.example",phone:"+91 98765 43210",fy:"FY 2025-26",status:"Active",team:"Industrial Coverage",projects:4,documents:62},
{id:"c-2",name:"Neha Iyer",company:"BluePeak Retail Ltd",industry:"Retail",email:"neha@bluepeak.example",phone:"+91 91234 56789",fy:"FY 2025-26",status:"Onboarding",team:"Retail Coverage",projects:2,documents:18},
{id:"c-3",name:"Vikram Singh",company:"Orion Software Solutions",industry:"Technology",email:"vikram@orion.example",phone:"+91 99887 66554",fy:"FY 2025-26",status:"Active",team:"Technology Coverage",projects:7,documents:103},
{id:"c-4",name:"Simran Kaur",company:"GreenBridge Infra LLP",industry:"Infrastructure",email:"simran@greenbridge.example",phone:"+91 98100 22334",fy:"FY 2025-26",status:"Prospect",team:"Infrastructure Coverage",projects:1,documents:7}
];
export const projects=[
{id:"p-1",name:"FY26 Financial Health Review",clientId:"c-1",clientName:"Aster Manufacturing Pvt Ltd",type:"Financial Analysis",fy:"FY 2025-26",currency:"INR",status:"Active",priority:"High",startDate:"2026-04-01",endDate:"2026-09-30",team:["Riya Sharma","Aarav Mehta"],tags:["Quarterly","Ratios","Cash Flow"]},
{id:"p-2",name:"BluePeak Tax Workspace",clientId:"c-2",clientName:"BluePeak Retail Ltd",type:"Tax Analysis",fy:"FY 2025-26",currency:"INR",status:"Under Review",priority:"Medium",startDate:"2026-05-10",endDate:"2026-10-15",team:["Aarav Mehta"],tags:["Tax","Reconciliation"]},
{id:"p-3",name:"Orion DCF Valuation",clientId:"c-3",clientName:"Orion Software Solutions",type:"Valuation",fy:"FY 2025-26",currency:"INR",status:"Active",priority:"High",startDate:"2026-07-01",endDate:"2026-10-31",team:["Riya Sharma","Aarav Mehta"],tags:["DCF","Scenario","EV/EBITDA"]},
{id:"p-4",name:"GreenBridge Due Diligence",clientId:"c-4",clientName:"GreenBridge Infra LLP",type:"Due Diligence",fy:"FY 2025-26",currency:"INR",status:"Draft",priority:"Low",startDate:"2026-09-15",endDate:"2026-11-15",team:["Riya Sharma"],tags:["DD","Contracts"]}
];
export const documents=[
{id:"d-1",name:"Aster_Annual_Report_FY25.pdf",type:"PDF",size:"4.8 MB",status:"Completed",uploadedBy:"Riya Sharma",uploadedAt:"2026-09-24",clientId:"c-1",projectId:"p-1",pages:126},
{id:"d-2",name:"Aster_PnL_FY25.xlsx",type:"XLSX",size:"1.3 MB",status:"Completed",uploadedBy:"Aarav Mehta",uploadedAt:"2026-09-23",clientId:"c-1",projectId:"p-1"},
{id:"d-3",name:"Aster_Transactions_Q4.csv",type:"CSV",size:"18.2 MB",status:"Analyzing",uploadedBy:"Riya Sharma",uploadedAt:"2026-09-26",clientId:"c-1",projectId:"p-1"},
{id:"d-4",name:"BluePeak_Tax_Recon.xlsx",type:"XLSX",size:"920 KB",status:"Processing",uploadedBy:"Aarav Mehta",uploadedAt:"2026-09-26",clientId:"c-2",projectId:"p-2"},
{id:"d-5",name:"Orion_Investor_Pack.pdf",type:"PDF",size:"8.1 MB",status:"Completed",uploadedBy:"Riya Sharma",uploadedAt:"2026-09-20",clientId:"c-3",projectId:"p-3",pages:78}
];
export const tasks=[
{id:"t-1",title:"Review EBITDA bridge",client:"Aster Manufacturing Pvt Ltd",project:"FY26 Financial Health Review",assignee:"Riya Sharma",priority:"High",due:"2026-09-28",status:"In Progress"},
{id:"t-2",title:"Validate tax reconciliation",client:"BluePeak Retail Ltd",project:"BluePeak Tax Workspace",assignee:"Aarav Mehta",priority:"Medium",due:"2026-09-30",status:"Review"},
{id:"t-3",title:"Update WACC assumptions",client:"Orion Software Solutions",project:"Orion DCF Valuation",assignee:"Riya Sharma",priority:"High",due:"2026-09-29",status:"To Do"},
{id:"t-4",title:"Prepare DD request list",client:"GreenBridge Infra LLP",project:"GreenBridge Due Diligence",assignee:"Riya Sharma",priority:"Low",due:"2026-10-02",status:"Completed"}
];
export const compliance=[
{id:"co-1",title:"Client deliverable review",client:"Aster Manufacturing Pvt Ltd",dueDate:"2026-09-28",category:"Deliverable",status:"Due Soon"},
{id:"co-2",title:"Internal audit evidence pack",client:"BluePeak Retail Ltd",dueDate:"2026-10-03",category:"Audit",status:"Upcoming"},
{id:"co-3",title:"Management reporting cycle",client:"Orion Software Solutions",dueDate:"2026-09-27",category:"Internal",status:"Overdue"},
{id:"co-4",title:"Compliance checklist refresh",client:"GreenBridge Infra LLP",dueDate:"2026-10-08",category:"Filing",status:"Upcoming"}
];
export const knowledgeBase=[
{id:"k-1",title:"Monthly MIS Template v3",kind:"Template",owner:"Aarav Mehta",updated:"2026-09-22"},
{id:"k-2",title:"Financial Review SOP",kind:"SOP",owner:"Aarav Mehta",updated:"2026-09-14"},
{id:"k-3",title:"Valuation Methodology",kind:"Methodology",owner:"Investment Team",updated:"2026-08-30"},
{id:"k-4",title:"Client Reporting Policy",kind:"Policy",owner:"Operations",updated:"2026-08-18"}
];