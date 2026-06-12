const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn } = require('../config/env');
const { one, exec } = require('../utils/db');

function publicUser(u){
  if(!u) return null;
  const enabled = u.enabled === undefined ? true : !!u.enabled;
  const blocked = u.blocked === undefined ? false : !!u.blocked;
  const deleted = u.deleted === undefined ? false : !!u.deleted;
  return {
    id:u.id,
    name:u.name,
    email:u.email,
    mobile:u.mobile || u.phone_number,
    phoneNumber:u.phone_number || u.mobile,
    role:u.role,
    status:u.status || (enabled && !blocked && !deleted ? 'ACTIVE' : 'INACTIVE'),
    imageUrl:u.image_url || u.profile_image,
    profileImage:u.profile_image || u.image_url,
    walletBalance:u.wallet_balance || 0,
    loyaltyPoints:u.loyalty_points || 0,
    createdAt:u.created_at
  };
}
function token(u){ return jwt.sign({ id:u.id, role:u.role, email:u.email, mobile:u.mobile || u.phone_number, name:u.name }, jwtSecret, { expiresIn: jwtExpiresIn }); }
async function register(body){
  const name=body.name||body.fullName||'User', email=body.email||null, mobile=body.mobile||body.phone||body.phoneNumber||null, role=(body.role||'USER').toUpperCase();
  if(!email && !mobile) throw Object.assign(new Error('Email or mobile is required'),{status:400});
  const exists=await one('SELECT * FROM users WHERE email <=> :email OR mobile <=> :mobile OR phone_number <=> :mobile',{email,mobile});
  if(exists) throw Object.assign(new Error('Account already exists'),{status:409});
  const hash=await bcrypt.hash(body.password||'123456',10);
  const r=await exec('INSERT INTO users(name,email,mobile,phone_number,password,role,enabled,blocked,deleted,created_at) VALUES(:name,:email,:mobile,:mobile,:hash,:role,1,0,0,NOW())',{name,email,mobile,hash,role});
  const u=await one('SELECT * FROM users WHERE id=:id',{id:r.insertId});
  return { token:token(u), user:publicUser(u) };
}
async function login(body){
  const ident=body.emailOrMobile||body.email||body.mobile||body.phone||body.phoneNumber;
  const password=body.password;
  const u=await one('SELECT * FROM users WHERE email=:ident OR mobile=:ident OR phone_number=:ident',{ident});
  const stored = u?.password_hash || u?.password || '';
  if(!u || !(await bcrypt.compare(password||'', stored))) throw Object.assign(new Error('Invalid credentials'),{status:401});
  if((u.enabled!==undefined && !u.enabled) || u.blocked || u.deleted) throw Object.assign(new Error('Account is not active'),{status:403});
  return { token:token(u), user:publicUser(u) };
}
module.exports={register,login,publicUser,token};
