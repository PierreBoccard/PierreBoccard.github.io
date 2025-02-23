---
title: "Gravitational lensing with automatic differentiation using wavelets"
layout: post
date: 2022-07-01 22:10
tag: glsumm
image:
headerImage: false
projects: true
hidden: true # don't count this post in blog pagination
description: ""
category: project
author: pierre
externalLink: false
---

This is a full-time summer project carried out between the first and second year of my master studies in astrophysics. 
* Duration: 2 months (July 2022 - August 2022)
* Supervisor: Aymeric Galan, Frederic Courbin (LASTRO, EPFL) 

### Overview

This project focuses on a gravitational lens system formed by a group of galaxies at redshift z = 0.422 lensing a bright background galaxy at redshift z = 2.001. The main peculiarity of this system is the presence of a luminous satellite near the Einstein radius, that slightly deforms the giant arc. 
The goal was to first study the system using the [Lenstronomy software](https://github.com/lenstronomy/lenstronomy) developped by S. Birrer to obtain a modelisation of the background galaxy using shapelets. We then swtiched to the [SLITronomy software](https://github.com/aymgal/SLITronomy) developped by A. Galan of EPFL, to reconstruct both the source and lens galaxies using a wavelet decomposition starting from the model we previously obtained with Lenstronomy. 

<figcaption class="caption"> HST image of the system studied SDSS J120602.09+514229.5 </figcaption>
<img class="image" src="/assets/images/system.png" alt="Alt Text">

The main idea of the project is to construct a model which contains hundreds of parameters. As this would be to complicated to compute, we have to constrain some parameters using either theoretical knowledge, observational information or assumptions in order to simplify the model. In order to find a sample of parameters that would fit our model we look to minimize the likelyhood function. To achieve this, we used two different numerical approaches : Particule Swarm Optimization (PSO), or Markov chain Monte Carlo (MCMC).

Here are two of the best models that we obtained using Lenstronomy and SLITronomy with also the observational data to compare it. In order to determine which model is the best one and if one is better than the other we computed for every model the Bayesian information criterion (BIC) but we also look at the residual and the magnification model for example. 

<figcaption class="caption"> The model obtained using lenstronomy with in the left bottom panel, the galaxy source reconstructed </figcaption>
<img class="image" src="/assets/images/final_shapelets.jpg" alt="Alt Text">

<figcaption class="caption"> The model obtained using SLITronomy with in the bottom panel, the galaxy source reconstructed </figcaption>
<img class="image" src="/assets/images/final_wavelets.jpg" alt="Alt Text">


**References**
* lenstronomy: Multi-purpose gravitational lens modelling software package [Birrer & Amara 2018](https://arxiv.org/abs/1803.09746)
* SLITronomy: towards a fully wavelet-based strong lensing inversion technique [Galan et al. 2020](https://arxiv.org/abs/2012.02802)
* Galaxy shapes of Light (GaLight): a 2D modeling of galaxy images [Ding et al. 2021](https://arxiv.org/abs/2111.08721)
* Using wavelets to capture deviations from smoothness in galaxy-scale strong lenses [Galan et al. 2022](https://arxiv.org/abs/2207.05763)


### About this project
* Gravitational lensing
   * Lenstronomy
   * Slitronomy
* Wavelets, shapelets
* Markov-chain Monte-Carlo, Particule Swarm Optimzation
* Dark matter, quasars, galaxies

### Links
* Here's the link to the [report](). (when it will be ready) 
