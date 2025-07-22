# 🌐 Custom Domain Setup for Your Portfolio

## Step 1: Choose and Buy Your Domain

### Recommended Domain Names:
- `doshbarzanji.dev` (professional developer branding)
- `doshbarzanji.com` (classic business domain)
- `quantumcore.dev` (branded after your flagship app)
- `doshdev.com` (short and memorable)

### Where to Buy:
- **Namecheap** (recommended) - Good prices, easy DNS management
- **GoDaddy** - Popular, more expensive
- **Google Domains** - Simple, integrates with Google services
- **Cloudflare** - Competitive pricing, built-in CDN

**Cost:** Usually $10-15/year for .com or .dev domains

## Step 2: Configure DNS Settings

After purchasing your domain, you need to point it to GitHub Pages:

### DNS Records to Add:
1. **A Records** (point to GitHub's IP addresses):
   - `185.199.108.153`
   - `185.199.109.153` 
   - `185.199.110.153`
   - `185.199.111.153`

2. **CNAME Record** (for www subdomain):
   - Name: `www`
   - Value: `YOUR_GITHUB_USERNAME.github.io`

### DNS Configuration Steps:

#### For Namecheap:
1. Login to Namecheap account
2. Go to Domain List → Manage
3. Advanced DNS tab
4. Add these records:
   - Type: A Record, Host: @, Value: 185.199.108.153
   - Type: A Record, Host: @, Value: 185.199.109.153
   - Type: A Record, Host: @, Value: 185.199.110.153
   - Type: A Record, Host: @, Value: 185.199.111.153
   - Type: CNAME, Host: www, Value: YOUR_USERNAME.github.io

#### For GoDaddy:
1. Login to GoDaddy account
2. My Products → DNS
3. Add records as shown above

#### For Cloudflare:
1. Login to Cloudflare
2. Add your domain as a site
3. Add the same A and CNAME records
4. Update nameservers at your domain registrar

## Step 3: Configure GitHub Pages

1. Go to your GitHub repository
2. Settings → Pages
3. Custom domain section:
   - Enter your domain (e.g., `doshbarzanji.dev`)
   - Check "Enforce HTTPS" (recommended)
4. Save changes

GitHub will automatically create a CNAME file in your repository.

## Step 4: Wait for Propagation

- DNS changes take 24-48 hours to fully propagate
- You can check status at: `https://www.whatsmydns.net/`
- GitHub will show a green checkmark when ready

## Step 5: Test Your Domain

Once propagation is complete:
- `https://yourdomain.com` → Your portfolio
- `https://www.yourdomain.com` → Your portfolio (redirects)
- SSL certificate automatically provided by GitHub

## Professional Email Setup (Optional)

Set up professional email addresses like `hello@yourdomain.com`:

### Option 1: Google Workspace ($6/month)
- Professional Gmail with your domain
- Google Drive, Calendar, Docs included

### Option 2: Cloudflare Email Routing (Free)
- Forward emails to your existing Gmail
- Professional appearance without cost

### Option 3: Microsoft 365 ($5/month)
- Outlook with your domain
- Office apps included

## Troubleshooting Common Issues

### Domain not working after 48 hours:
- Check DNS records are correct
- Ensure GitHub Pages is enabled
- Verify custom domain is set in repository settings

### SSL certificate not working:
- Uncheck and re-check "Enforce HTTPS" in GitHub settings
- Wait 24 hours for certificate generation

### www subdomain not working:
- Ensure CNAME record for www is correct
- Value should be `YOUR_USERNAME.github.io` (not the full repo URL)

## Benefits of Custom Domain

✅ **Professional appearance** for client presentations
✅ **Brand consistency** across all marketing materials
✅ **Better SEO** and memorability
✅ **Email forwarding** capabilities
✅ **SSL certificate** automatically provided
✅ **Full control** over your professional presence

## Cost Summary

- **Domain registration:** $10-15/year
- **GitHub Pages hosting:** Free
- **SSL certificate:** Free (via GitHub)
- **Professional email (optional):** $0-6/month

Total minimum cost: Just $10-15/year for a professional domain!

## Next Steps After Setup

1. Update business cards and resume with new domain
2. Add domain to LinkedIn profile
3. Set up professional email forwarding
4. Consider Google Analytics for traffic tracking
5. Update any existing portfolio links

Your professional domain will significantly enhance your credibility when reaching out to potential clients and employers in the freight and logistics industry.