# 🚀 Deploy Your Portfolio to GitHub Pages

## Step 1: Create GitHub Repository
1. Go to [github.com](https://github.com) and sign in
2. Click the **"New"** button (green button) to create new repository
3. Name it: `dosh-portfolio` or `portfolio-website`
4. Make it **Public** (required for free GitHub Pages)
5. Don't initialize with README (we already have files)
6. Click **"Create repository"**

## Step 2: Upload Your Files
After creating the repository, you'll see a page with upload instructions. Follow these steps:

### Option A: Using GitHub Web Interface (Easiest)
1. Click **"uploading an existing file"**
2. Drag and drop these files from your `portfolio-site` folder:
   - `index.html` 
   - `README.md`
   - `deploy-instructions.md`
   - `.gitignore`
3. Write commit message: "Initial portfolio website"
4. Click **"Commit changes"**

### Option B: Using Git Commands (if you have Git installed)
```bash
cd portfolio-site
git init
git add .
git commit -m "Initial portfolio website"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/dosh-portfolio.git
git push -u origin main
```

## Step 3: Enable GitHub Pages
1. In your repository, go to **Settings** tab
2. Scroll down to **"Pages"** section in left sidebar
3. Under "Source", select **"Deploy from a branch"**
4. Choose **"main"** branch
5. Choose **"/ (root)"** folder
6. Click **"Save"**

## Step 4: Get Your Live URL
- GitHub will give you a URL like: `https://YOUR_USERNAME.github.io/dosh-portfolio`
- It takes 2-10 minutes for the site to go live
- You'll see a green checkmark when it's ready

## Step 5: Share Your Portfolio
Your portfolio will be live at: `https://YOUR_USERNAME.github.io/dosh-portfolio`

Use this link on:
- LinkedIn profile
- Resume/CV
- Email signatures  
- Business cards
- Job applications
- Client proposals

## Updates and Maintenance
To update your portfolio:
1. Edit files in your repository
2. Commit changes
3. GitHub Pages automatically updates your live site

## Optional: Custom Domain
For a professional custom domain (like `doshbarzanji.dev`):
1. Buy domain from Namecheap/GoDaddy
2. In repository Settings → Pages → Custom domain
3. Enter your domain name
4. Update DNS settings at your domain provider

## Your Portfolio Features
✅ Professional developer branding
✅ QuantumCore showcase as flagship project  
✅ Contact form with email integration
✅ SEO optimized for search engines
✅ Mobile responsive design
✅ Fast loading and modern design

Your portfolio is now ready to attract clients and showcase your software development expertise!