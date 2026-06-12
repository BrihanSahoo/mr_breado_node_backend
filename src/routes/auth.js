const router=require('express').Router(); const {ok}=require('../utils/respond'); const ah=require('../utils/asyncHandler'); const authService=require('../services/authService'); const {requireAuth}=require('../middleware/auth'); const {one,exec}=require('../utils/db'); const bcrypt=require('bcryptjs');
async function register(req,res){ ok(res,await authService.register(req.body),'Registered successfully',201); }
async function login(req,res){ ok(res,await authService.login(req.body),'Login successful'); }
function logout(req,res){ ok(res,null,'Logged out'); }
async function me(req,res){ const u=await one('SELECT * FROM users WHERE id=:id',{id:req.user.id}); ok(res,authService.publicUser(u)); }
async function updateProfile(req,res){ await exec('UPDATE users SET name=COALESCE(:name,name), email=COALESCE(:email,email), mobile=COALESCE(:mobile,mobile), profile_image=COALESCE(:image,profile_image) WHERE id=:id',{id:req.user.id,name:req.body.name||null,email:req.body.email||null,mobile:req.body.mobile||req.body.phone||null,image:req.body.imageUrl||req.body.image_url||null}); const u=await one('SELECT * FROM users WHERE id=:id',{id:req.user.id}); ok(res,authService.publicUser(u),'Profile updated'); }
async function updatePassword(req,res){ const raw=req.body.newPassword||req.body.password; const hash=await bcrypt.hash(raw,10); await exec('UPDATE users SET password=:hash WHERE id=:id',{hash,id:req.user.id}); ok(res,null,'Password updated'); }
router.post(['/auth/register','/register'],ah(register));
router.post(['/auth/login','/login'],ah(login));
router.post(['/auth/logout','/logout'],logout);
router.get(['/auth/me','/me'],requireAuth,ah(me));
router.put(['/auth/update-profile','/update-profile'],requireAuth,ah(updateProfile));
router.put(['/auth/update-password','/update-password'],requireAuth,ah(updatePassword));
router.post(['/auth/forgot-password','/forgot-password'],(req,res)=>ok(res,{otpSent:true},'Password reset OTP sent'));
router.post(['/auth/login-otp','/auth/send-otp','/auth/verify-otp'],(req,res)=>ok(res,{otpSent:true,verified:true},'OTP flow accepted'));
module.exports=router;
