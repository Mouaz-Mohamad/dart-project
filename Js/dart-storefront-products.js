// DART | Shared storefront merchandising rules.
// Model IDs are chosen only by staff; never infer Best Products from sales or stock.
(function(root){
  "use strict";
  const defaults=Object.freeze({productsFirstGroupCount:6,homeNewestCount:8,bestProductsLimit:5,bestModelIds:[]});
  const count=(value,fallback,max=300)=>Number.isInteger(Number(value))&&value!==""&&value!==null
    ?Math.max(0,Math.min(max,Number(value))):fallback;
  function normalize(input){
    const source=input?.storefrontProducts||input||{};
    const ids=Array.isArray(source.bestModelIds)?source.bestModelIds:[];
    return {
      productsFirstGroupCount:count(source.productsFirstGroupCount,defaults.productsFirstGroupCount),
      homeNewestCount:count(source.homeNewestCount,defaults.homeNewestCount),
      bestProductsLimit:count(source.bestProductsLimit,defaults.bestProductsLimit,100),
      bestModelIds:[...new Set(ids.map(id=>String(id||"").trim()).filter(Boolean))].slice(0,100)
    };
  }
  const modelId=card=>String(card?.code||card?.modelId||card?.id||"");
  function hasStock(card){
    const stock=card?.stock||{};
    return Object.values(stock).some(colors=>Object.values(colors||{}).some(amount=>Number(amount)>0));
  }
  function best(cards,input){
    const rule=normalize(input);
    const grouped=new Map();
    for(const card of cards||[]){
      const id=modelId(card);
      if(!grouped.has(id))grouped.set(id,card);
      else if(!hasStock(grouped.get(id))&&hasStock(card))grouped.set(id,card);
    }
    return rule.bestModelIds.map(id=>grouped.get(id)).filter(Boolean).slice(0,rule.bestProductsLimit);
  }
  function newest(cards,input){return (cards||[]).slice(0,normalize(input).homeNewestCount);}
  function groups(cards,input){
    const list=cards||[],index=normalize(input).productsFirstGroupCount;
    return [list.slice(0,index),list.slice(index)];
  }
  const api={defaults,normalize,best,newest,groups};
  root.DartStorefrontProducts=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
