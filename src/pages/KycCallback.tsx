import {useEffect} from "react";
import {useNavigate,useSearchParams} from "react-router-dom";

export default function KycCallback(){
  const [params]=useSearchParams();
  const navigate=useNavigate();

  useEffect(()=>{
    const ref=params.get("kyc_ref");
    const error=params.get("error");
    if(ref) sessionStorage.setItem("finpro_kyc_ref",ref);
    sessionStorage.setItem("finpro_kyc_callback",error?"error":"success");
    navigate("/signup",{replace:true});
  },[params,navigate]);

  return <div className="center-screen"><div className="spinner"/></div>;
}
