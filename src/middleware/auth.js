const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
function auth(optional=false){return (req,res,next)=>{const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):null; if(!token){ if(optional){req.user=null; return next();} return res.status(401).json({success:false,message:'Authentication required'});} try{req.user=jwt.verify(token,jwtSecret); next();}catch(e){return res.status(401).json({success:false,message:'Invalid or expired token'});}}}
const requireAuth = auth(false); const optionalAuth = auth(true);
const role = (...roles)=>(req,res,next)=>{ if(!req.user) return res.status(401).json({success:false,message:'Authentication required'}); if(roles.length && !roles.includes(req.user.role)) return res.status(403).json({success:false,message:'Access denied'}); next(); };
module.exports={auth,requireAuth,optionalAuth,role};
