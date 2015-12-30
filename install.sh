sudo apt-get -qq update
sudo apt-get -qq upgrade -y
sudo apt-get install -y git npm
ln -s /usr/bin/nodejs /usr/bin/node

git clone https://github.com/nothingheremovealong/github-to-phabricator.git
cd github-to-phabricator
npm install
