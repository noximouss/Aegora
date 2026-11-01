(function(root){
  const DEFAULT_PROFILE=Object.freeze({id:"default",name:"Personal",isDefault:true});
  const MAX_PROFILES=10,MAX_NAME=28,ID_RE=/^[a-z0-9-]{3,64}$/;
  function normalizeProfiles(value){
    const result=[{...DEFAULT_PROFILE}],ids=new Set(["default"]),names=new Set(["personal"]);
    for(const item of (Array.isArray(value)?value:[])){
      if(result.length>=MAX_PROFILES)break;
      if(!item||typeof item!=="object")continue;
      const id=String(item.id||"").toLowerCase(),name=String(item.name||"").trim().slice(0,MAX_NAME),key=name.toLocaleLowerCase("en-US");
      if(!ID_RE.test(id)||ids.has(id)||!name||/[\u0000-\u001f\u007f]/.test(name)||names.has(key))continue;
      ids.add(id);names.add(key);result.push({id,name,isDefault:false});
    }
    return result;
  }
  function validateProfileName(value,profiles){
    const name=String(value||"").trim();
    if(!name)return {ok:false,code:"empty"};
    if(name.length>MAX_NAME)return {ok:false,code:"too-long"};
    if(/[\u0000-\u001f\u007f]/.test(name))return {ok:false,code:"invalid"};
    if(normalizeProfiles(profiles).length>=MAX_PROFILES)return {ok:false,code:"limit"};
    if(normalizeProfiles(profiles).some(p=>p.name.toLocaleLowerCase("en-US")===name.toLocaleLowerCase("en-US")))return {ok:false,code:"duplicate"};
    return {ok:true,name};
  }
  function partitionFor(id){const key=String(id||"").toLowerCase();if(key==="default")return null;if(!ID_RE.test(key))return null;return `persist:aegora-profile-${key}`}
  const api={DEFAULT_PROFILE,MAX_PROFILES,MAX_NAME,normalizeProfiles,validateProfileName,partitionFor};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.AegoraProfiles=api;
})(typeof window!=="undefined"?window:null);
